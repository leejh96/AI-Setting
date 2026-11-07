// Read literal command words without executing the shell or expanding variables.
const shellTokens = /[ \t\r]+|#[^\n]*|(?:\d+)?(?:<<-|<<<|<<|>>|<>|>&|<&|[<>])|&&|\|\||[;\n|&()]/;
const posixWords = /(?:'[^']*'|"(?:\\.|[^"\\])*"|\\[\s\S]|[^\s'"\\;&|()<>])+/;
const windowsWords = /(?:'(?:[^']|'')*'|"(?:\x60[\s\S]|[^"\x60])*"|\x60[\s\S]|[^\s'"\x60;&|()<>])+/;
const separators = new Set(['\n', ';', '&&', '||', '|', '&', '(', ')']);

function literalWord(raw, windows) {
  let word = '';
  let quote = '';
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (quote === char) {
      if (windows && char === "'" && raw[i + 1] === "'") {
        word += char;
        i++;
      } else {
        quote = '';
      }
    } else if (!quote && (char === '"' || char === "'")) {
      quote = char;
    } else if (windows && char === '\x60' && quote !== "'") {
      if (!/[\r\n]/.test(raw[i + 1] ?? '')) word += raw[i + 1] ?? '';
      i++;
    } else if (!windows && char === '\\' && quote !== "'"
      && (!quote || /[$"\\\x60\n]/.test(raw[i + 1] ?? ''))) {
      if (raw[i + 1] !== '\n') word += raw[i + 1] ?? '';
      i++;
    } else {
      word += char;
    }
  }
  return word;
}

export function* shellCommands(input, windows) {
  const tokens = new RegExp(shellTokens.source + '|' + (windows ? windowsWords : posixWords).source, 'y');
  let words = [];
  let redirect = '';
  const documents = [];

  while (tokens.lastIndex < input.length) {
    const match = tokens.exec(input);
    if (!match) {
      // Retain a command prefix that was already read before unsupported syntax.
      break;
    }
    const raw = match[0];
    if (/^[ \t\r#]/.test(raw)) continue;
    if (separators.has(raw)) {
      if (words.length) yield words;
      words = [];
      redirect = '';
      if (raw === '\n') {
        for (const { delimiter, stripTabs } of documents.splice(0)) {
          let terminated = false;
          while (tokens.lastIndex < input.length) {
            const end = input.indexOf('\n', tokens.lastIndex);
            const line = input.slice(tokens.lastIndex, end === -1 ? input.length : end)
              .replace(/\r$/, '');
            tokens.lastIndex = end === -1 ? input.length : end + 1;
            if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) {
              terminated = true;
              break;
            }
          }
          if (!terminated) return;
        }
      }
      continue;
    }
    if (/^\d*[<>]/.test(raw)) {
      redirect = raw.replace(/^\d+/, '');
      continue;
    }
    // A line continuation alone must not add an empty argument.
    if (raw === (windows ? '\x60\n' : '\\\n')) continue;
    const word = literalWord(raw, windows);
    if (redirect === '<<' || redirect === '<<-') {
      documents.push({ delimiter: word, stripTabs: redirect === '<<-' });
    }
    if (!redirect) words.push(word);
    redirect = '';
  }
  if (words.length) yield words;
}
