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
  for (let start = 0; start < text.length;) {
    const end = text.indexOf('\n', start);
    const rawLine = text.slice(start, end === -1 ? text.length : end - (text.charCodeAt(end - 1) === 13 ? 1 : 0));
    start = end === -1 ? text.length : end + 1;
    if (fence?.ownerIndent === 0) {
      // A leading tab expands beyond the three-space closing-fence limit.
      if (closesFence(rawLine, fence)) fence = null;
      continue;
    }
    if (!fence && !listIndents.length && rawLine && !/^[-+*`~>#_ \t0-9]/.test(rawLine)) {
      paragraphOpen = true;
      continue;
    }
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
      if (blank || indent >= fence.ownerIndent) {
        if (closesFence(line.slice(fence.ownerIndent), fence)) fence = null;
        continue;
      }
      // Dedenting out of a list also ends its unclosed fenced block.
      fence = null;
    }
    if (blank) {
      paragraphOpen = false;
      continue;
    }

    const lazyContinuation = paragraphOpen && !interruptsParagraph(line);
    while (listIndents.length && indent < listIndents.at(-1) && !lazyContinuation) {
      listIndents.pop();
    }
    let ownerIndent = listIndents.at(-1) ?? 0;
    let content = line.slice(Math.min(indent, ownerIndent));
    // Explicit quote lines cannot contain the unquoted final status line.
    if (/^ {0,3}>/.test(content)) {
      paragraphOpen = false;
      continue;
    }
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
  return fence === null;
}
