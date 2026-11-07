import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function git(directory, ...args) {
  const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true });
  if (result.error?.code === 'ENOENT') return undefined;
  if (result.error) throw new Error('Git을 실행할 수 없습니다.');
  return result.status === 0 ? result.stdout.replace(/\r?\n$/, '') : undefined;
}

function remoteIdentity(protocol, host, port, repository, user = '') {
  host = host.toLowerCase();
  // GitHub's public clone URLs share the owner/repository namespace across transports.
  if (host === 'github.com' && !port && (protocol === 'https:' || (protocol === 'ssh:' && user === 'git'))) {
    const githubRepository = repository.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
    if (/^[\w.-]+\/[\w.-]+$/.test(githubRepository)) return ['remote', host, '', githubRepository];
  }
  if (!repository || (protocol === 'ssh:' && !user)) return undefined;
  return ['remote', protocol, host, port, user, repository];
}

function parseOrigin(origin, root) {
  if (!origin) return {};
  if (isAbsolute(origin)) return { local: origin };

  if (origin.includes('://')) {
    let url;
    try {
      url = new URL(origin);
      if (url.protocol === 'file:') return { local: fileURLToPath(url) };
    } catch {
      return {};
    }
    const defaultPorts = { 'https:': '443', 'http:': '80', 'ssh:': '22', 'git:': '9418' };
    if (!Object.hasOwn(defaultPorts, url.protocol) || !url.hostname || url.search || url.hash) return {};
    const port = url.port === defaultPorts[url.protocol] ? '' : url.port;
    const isPublicGitHub = url.protocol === 'https:' && url.hostname === 'github.com' && !port;
    if (!isPublicGitHub && (url.password || (url.username && url.protocol !== 'ssh:'))) return {};
    const user = url.protocol === 'ssh:' ? url.username : '';
    return { identity: remoteIdentity(url.protocol, url.hostname, port, url.pathname, user) };
  }

  const ssh = /^(?:([^@/\\:]+)@)?(\[[\da-fA-F:]+\]|[^@:/\\]+):([^:].*)$/.exec(origin);
  if (ssh) return { identity: remoteIdentity('ssh:', ssh[2], '', ssh[3], ssh[1]) };
  return { local: resolve(root, origin) };
}

function inspectGit(directory) {
  const commonDir = git(directory, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  if (!commonDir) return undefined;
  const root = git(directory, 'rev-parse', '--show-toplevel') || directory;
  return { commonDir, root, origin: git(root, 'remote', 'get-url', 'origin') };
}

function gitIdentity(directory, readGit, visited = []) {
  const repositoryInfo = readGit(directory);
  if (!repositoryInfo?.commonDir) return undefined;

  const canonicalDir = realpathSync.native(repositoryInfo.commonDir);
  const cycleStart = visited.indexOf(canonicalDir);
  if (cycleStart !== -1) return ['git', visited.slice(cycleStart).sort()[0]];
  visited.push(canonicalDir);

  const origin = parseOrigin(repositoryInfo.origin, repositoryInfo.root);
  if (origin.identity) return origin.identity;
  if (origin.local) {
    const upstream = gitIdentity(origin.local, readGit, visited);
    if (upstream) return upstream;
  }
  return ['git', canonicalDir];
}

function storageRoot() {
  const directory = process.env.CODEX_LESSONS_DIR || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'task-lessons');
  if (!isAbsolute(directory)) throw new Error('교훈 저장 루트는 절대 경로로 지정해야 합니다.');
  return resolve(directory);
}

class GitProbe extends Error {
  constructor(directory) {
    super('Git 저장소 정보가 필요합니다.');
    this.directory = directory;
  }
}

function pipedGit() {
  let entries;
  try {
    entries = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    throw new Error('Git 조회 결과를 읽을 수 없습니다.');
  }
  const snapshots = new Map(entries.map(info => [info.directory, info]));
  return directory => {
    if (!snapshots.has(directory)) throw new GitProbe(directory);
    return snapshots.get(directory);
  };
}

try {
  const root = storageRoot();
  const [directoryArgument, mode] = process.argv.slice(2);
  const directory = realpathSync.native(directoryArgument || process.cwd());
  const readGit = mode === '--git-stdin' ? pipedGit() : inspectGit;
  const identity = gitIdentity(directory, readGit) || ['directory', directory];
  const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  console.log(JSON.stringify({ project: join(root, 'projects', key), shared: join(root, 'shared') }));
} catch (error) {
  if (error instanceof GitProbe) {
    console.log(JSON.stringify({ probe: error.directory }));
  } else {
    console.error(`교훈 저장 경로를 확인할 수 없습니다. ${error.code || error.message}`);
    process.exitCode = 1;
  }
}
