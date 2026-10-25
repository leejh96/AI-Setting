function openingFence(line) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match || (match[1][0] === '`' && match[2].includes('`'))) return null;
  return { char: match[1][0], length: match[1].length };
}

function closesFence(line, fence) {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return match && match[1][0] === fence.char && match[1].length >= fence.length;
}

function isThematicBreak(line) {
  return /^ {0,3}(?:(?:\* *){3,}|(?:- *){3,}|(?:_ *){3,})$/.test(line);
}

function listMarker(line, paragraphOpen) {
  if (isThematicBreak(line)) return null;
  const match = /^( {0,3})([-+*]|\d{1,9}[.)])( +|$)(.*)$/.exec(line);
  if (!match) return null;
  if (paragraphOpen && (/^\d/.test(match[2]) && !/^1[.)]$/.test(match[2]))) return null;
  if (paragraphOpen && !match[4]) return null;
  const padding = match[3].length > 4 ? 1 : Math.max(1, match[3].length);
  const indent = match[1].length + match[2].length + padding;
  return { indent, content: line.slice(indent) };
}

function interruptsParagraph(line) {
  return openingFence(line) || /^ {0,3}(?:>|#{1,6}(?: |$))/.test(line)
    || isThematicBreak(line)
    || listMarker(line, true);
}

export function hasTerminalReviewStatus(message) {
  if (typeof message !== 'string') return false;
  const text = message.trimEnd();
  if (!/(?:^|\r?\n)\[code-quality-review:(clean|skipped|blocked)\]$/.test(text)) return false;

  const listIndents = [];
  let paragraphOpen = false;
  let fence = null;
  let quoteParagraphOpen = false;
  let quoteFence = null;
  let quoteParagraphDepth = 0, quoteParagraphIndent = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    // Markdown indentation uses four-column tab stops.
    let extra = 0;
    const line = !rawLine.includes('\t') ? rawLine : rawLine.replace(/\t/g, (_, offset) => {
      const width = 4 - (offset + extra) % 4;
      extra += width - 1;
      return ' '.repeat(width);
    });
    const blank = /^ *$/.test(line);
    const indent = /^ */.exec(line)[0].length;
    if (fence) {
      if (fence.ownerIndent === 0 || blank || indent >= fence.ownerIndent) {
        if (closesFence(line.slice(fence.ownerIndent), fence)) fence = null;
        continue;
      }
      // Dedenting out of a list also ends its unclosed fenced block.
      fence = null;
    }
    if (blank) {
      paragraphOpen = false;
      quoteParagraphOpen = false;
      quoteFence = null;
      continue;
    }

    const lazyContinuation = paragraphOpen && !interruptsParagraph(line);
    while (listIndents.length && indent < listIndents.at(-1) && !lazyContinuation) {
      listIndents.pop();
    }
    let ownerIndent = listIndents.at(-1) ?? 0;
    let content = line.slice(Math.min(indent, ownerIndent));
    if (/^ {0,3}>/.test(content)) {
      let depth = 0, prefix;
      while ((prefix = /^ {0,3}> ?/.exec(content))) {
        content = content.slice(prefix[0].length);
        if (++depth === quoteFence?.depth) break;
      }
      if (quoteFence && (depth < quoteFence.depth
          || (content.trim() && /^ */.exec(content)[0].length < quoteFence.ownerIndent))) quoteFence = null;
      if (quoteFence) {
        if (closesFence(content.slice(quoteFence.ownerIndent), quoteFence)) quoteFence = null;
        quoteParagraphOpen = false;
      } else {
        const continuedParagraph = quoteParagraphOpen && quoteParagraphDepth === depth;
        quoteParagraphOpen = continuedParagraph;
        let marker, quoteIndent = 0;
        while ((marker = listMarker(content, quoteParagraphOpen))) {
          quoteIndent += marker.indent;
          content = marker.content;
          quoteParagraphOpen = false;
        }
        const opener = openingFence(content);
        quoteFence = opener && { ...opener, depth, ownerIndent: quoteIndent };
        const setextHeading = quoteParagraphOpen && continuedParagraph
          && /^ */.exec(content)[0].length >= quoteParagraphIndent
          && /^ {0,3}(?:=+|-+) *$/.test(content.slice(quoteParagraphIndent));
        quoteParagraphOpen = !quoteFence && (!!quoteParagraphOpen || !/^ {4}/.test(content)) && !!content.trim()
          && !setextHeading && !/^ {0,3}#{1,6}(?: |$)/.test(content) && !isThematicBreak(content);
        quoteParagraphIndent = continuedParagraph && !quoteIndent ? quoteParagraphIndent : quoteIndent;
        quoteParagraphDepth = depth;
      }
      paragraphOpen = false;
      continue;
    }
    // A quote paragraph can continue without another > until a blank or block boundary.
    if (quoteParagraphOpen && !interruptsParagraph(content)) continue;
    quoteParagraphOpen = false;
    quoteFence = null;
    let marker;
    while ((marker = listMarker(content, paragraphOpen))) {
      ownerIndent += marker.indent;
      listIndents.push(ownerIndent);
      content = marker.content;
      paragraphOpen = false;
    }
    const opener = openingFence(content);
    if (opener) {
      fence = { ...opener, ownerIndent };
      paragraphOpen = false;
    } else {
      paragraphOpen = !/^ {0,3}#{1,6}(?: |$)/.test(content) && !isThematicBreak(content);
    }
  }
  return fence === null && !quoteParagraphOpen;
}
