import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import process from 'node:process';

const unsupported = 'Git을 실행할 수 없고 파일만으로 프로젝트 키를 확인할 수 없습니다.';

function readIfPresent(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function directoryFromFile(parent, text) {
  const path = text.replace(/[\r\n]+$/u, '');
  if (!path || /[\0\r\n]/u.test(path)) throw new Error(unsupported);
  return resolve(parent, path);
}

function configValue(text) {
  const escapes = { '"': '"', '\\': '\\', n: '\n', t: '\t', b: '\b' };
  let quoted = false, value = '', spaces = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '\\') {
      const escaped = escapes[text[++index]];
      if (escaped === undefined) throw new Error(unsupported);
      value += spaces + escaped;
      spaces = '';
    } else if (char === '"') {
      value += spaces;
      spaces = '';
      quoted = !quoted;
    } else if (!quoted && (char === '#' || char === ';')) {
      break;
    } else if (!quoted && /\s/u.test(char)) {
      if (value) spaces += char;
    } else {
      value += spaces + char;
      spaces = '';
    }
  }
  if (quoted) throw new Error(unsupported);
  return value;
}

function* configEntries(content) {
  let section, subsection;
  for (const raw of content.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    let line = raw.trimStart();
    if (!line || /^[#;]/u.test(line)) continue;
    if (/(?:^|[^\\])(?:\\\\)*\\$/u.test(line)) throw new Error(unsupported);
    if (line.startsWith('[')) {
      const header = /^\[([a-z0-9-]+)(?:\.([a-z0-9.-]+)|\s+"((?:[^"\\]|\\.)*)")?\]/iu.exec(line);
      if (!header) throw new Error(unsupported);
      section = header[1].toLowerCase();
      subsection = header[3]?.replace(/\\(.)/gu, '$1') ?? header[2]?.toLowerCase();
      line = line.slice(header[0].length).trimStart();
      if (!line || /^[#;]/u.test(line)) continue;
    }
    const variable = /^([a-z][a-z0-9-]*)\s*(?:=(.*)|[#;].*)?$/iu.exec(line);
    if (!section || !variable) throw new Error(unsupported);
    yield { section, subsection, key: variable[1].toLowerCase(), value: variable[2] };
  }
}

function systemConfigPaths() {
  if (process.platform !== 'win32') return ['/etc/gitconfig', '/usr/local/etc/gitconfig', '/opt/homebrew/etc/gitconfig'];
  const paths = process.env.ProgramData ? [join(process.env.ProgramData, 'Git', 'config')] : [];
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    if (!statSync(join(directory, 'git.exe'), { throwIfNoEntry: false })?.isFile()) continue;
    const prefix = dirname(directory);
    paths.push(join(prefix, 'etc', 'gitconfig'), join(prefix, 'mingw64', 'etc', 'gitconfig'));
    return paths;
  }
  if (process.env.ProgramFiles) paths.push(join(process.env.ProgramFiles, 'Git', 'etc', 'gitconfig'));
  return paths;
}

function readOrigin(commonDir, bare) {
  const home = process.env.HOME || homedir();
  const paths = [
    ...systemConfigPaths(), join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'git', 'config'),
    join(home, '.gitconfig'), join(commonDir, 'config'),
  ];
  const rewrites = [];
  let origin;
  for (const file of new Set(paths)) {
    for (const { section, subsection, key, value } of configEntries(readIfPresent(file) ?? '')) {
      if (key === 'path' && (section === 'include' || section === 'includeif')) throw new Error(unsupported);
      if (section === 'core' && key === 'worktree') throw new Error(unsupported);
      if (section === 'core' && key === 'bare' && /^(?:true|on|yes|1)$/iu.test(configValue(value ?? 'true')) !== bare) {
        throw new Error(unsupported);
      }
      if (section === 'extensions' && key === 'worktreeconfig'
        && !/^(?:false|off|no|0)$/iu.test(configValue(value ?? 'true'))) throw new Error(unsupported);
      if (section === 'remote' && subsection === 'origin' && key === 'url') origin ??= configValue(value ?? '');
      if (section === 'url' && subsection !== undefined && key === 'insteadof') {
        rewrites.push({ base: subsection, prefix: configValue(value ?? '') });
      }
    }
  }
  if (origin === undefined) {
    if (['remotes', 'branches'].some(name => statSync(join(commonDir, name, 'origin'), { throwIfNoEntry: false }))) {
      throw new Error(unsupported);
    }
    return undefined;
  }
  const rule = rewrites.filter(({ prefix }) => origin.startsWith(prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return rule ? rule.base + origin.slice(rule.prefix.length) : origin;
}

export function inspectGitFiles(directory) {
  let start;
  try {
    start = realpathSync.native(directory);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
    throw error;
  }
  const initial = statSync(start);
  if (!initial.isDirectory()) return undefined;

  for (let root = start;; root = dirname(root)) {
    if (statSync(root).dev !== initial.dev) return undefined;
    const marker = join(root, '.git');
    const entry = statSync(marker, { throwIfNoEntry: false });
    let gitDir;
    if (entry?.isDirectory()) gitDir = marker;
    else if (entry?.isFile()) {
      const pointer = /^gitdir: ([^\0]+)$/u.exec(readFileSync(marker, 'utf8'));
      if (!pointer) throw new Error(unsupported);
      gitDir = directoryFromFile(root, pointer[1]);
    } else if (entry) throw new Error(unsupported);
    else if (statSync(join(root, 'HEAD'), { throwIfNoEntry: false })?.isFile()
      && statSync(join(root, 'objects'), { throwIfNoEntry: false })?.isDirectory()
      && statSync(join(root, 'refs'), { throwIfNoEntry: false })?.isDirectory()) gitDir = root;

    if (gitDir) {
      const common = readIfPresent(join(gitDir, 'commondir'));
      const commonDir = common === undefined ? gitDir : directoryFromFile(gitDir, common);
      if (!statSync(join(gitDir, 'HEAD'), { throwIfNoEntry: false })?.isFile()
        || !statSync(join(commonDir, 'objects'), { throwIfNoEntry: false })?.isDirectory()) throw new Error(unsupported);
      return { commonDir, root: entry ? root : start, origin: readOrigin(commonDir, !entry) };
    }
    if (dirname(root) === root) return undefined;
  }
}
