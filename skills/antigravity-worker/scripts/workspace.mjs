import { spawnSync } from 'node:child_process';
import { closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

const prefix = 'codex-agy-workspace-';
const namePattern = /^codex-agy-workspace-[a-z0-9]{6}$/i;
const manifest = 'workspace.json';
const gitPathOverrides = new Set(['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_NAMESPACE']);
const workspaceRoot = (job) => join(realpathSync(job), 'workspaces');

export function git(cwd, args, allowed = [0], options = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !gitPathOverrides.has(name.toUpperCase())));
  const result = spawnSync('git', ['-C', cwd, ...args], {
    env, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, ...options,
  });
  if (result.error) throw result.error;
  if (!allowed.includes(result.status)) throw new Error(result.stderr.trim() || 'Git workspace check failed.');
  return result.stdout;
}

function sameEntry(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

function sameDirectory(path, otherPath) {
  const entry = statSync(path, { bigint: true });
  const other = statSync(otherPath, { bigint: true });
  return entry.isDirectory() && other.isDirectory() && sameEntry(entry, other);
}

function localDirectory(path) {
  if (!isAbsolute(path) || !lstatSync(path).isDirectory() || realpathSync(path) !== path) {
    throw new Error('Expected a canonical local directory: ' + path);
  }
  return path;
}

export function prepareWorkspace(job, target, { copy = false } = {}) {
  let original;
  let commit;
  if (target !== undefined) {
    if (!isAbsolute(target)) throw new Error('Pass an absolute original Git worktree path.');
    original = realpathSync(target);
    const top = git(original, ['rev-parse', '--show-toplevel']).trim();
    if (!sameDirectory(top, original)) throw new Error('Pass the root of the original Git worktree.');
    commit = copy ? copyCommit(original) : git(original, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  }
  if (copy && !original) throw new Error('A Git repository is required for a file-only workspace.');
  const baseline = copy ? readTree(original, commit) : undefined;
  if (baseline && [...baseline.values()].some(entry => !['100644', '100755'].includes(entry.mode))) {
    throw new Error('File-only workspaces require a tree of regular files.');
  }
  const root = workspaceRoot(job);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const storage = localDirectory(root);
  const directory = mkdtempSync(join(storage, prefix));
  const cwd = join(directory, 'work');
  try {
    if (original && !copy) git(original, ['worktree', 'add', '--detach', '--', cwd, commit]);
    else {
      mkdirSync(cwd);
      if (baseline) writeBaseline(original, cwd, baseline);
    }
  } catch (error) {
    if (!readdirSync(directory).length) rmdirSync(directory);
    else throw new Error(`Could not prepare ${cwd}: ${error.message}`);
    throw error;
  }
  const { dev, ino } = lstatSync(cwd);
  writeFileSync(join(directory, manifest), JSON.stringify({ original, dev, ino }), { flag: 'wx', mode: 0o600 });
  return { cwd, kind: original && !copy ? 'git' : 'temporary', ...(original ? { original } : {}) };
}

export function managedWorkspace(cwd, job) {
  const directory = dirname(cwd);
  if (basename(cwd) !== 'work' || !namePattern.test(basename(directory)) || dirname(directory) !== workspaceRoot(job)) return null;
  localDirectory(directory);
  const path = join(directory, manifest);
  if (!lstatSync(path).isFile()) throw new Error('Invalid worker workspace record.');
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (!sameEntry(lstatSync(localDirectory(cwd)), record)
      || (record.original !== undefined && !isAbsolute(record.original))) {
    throw new Error('Worker workspace identity changed.');
  }
  return { cwd, directory, original: record.original };
}

export function lockWorkspace(workspace) {
  const path = join(workspace.directory, 'operation.lock');
  writeFileSync(path, '', { flag: 'wx', mode: 0o600 });
  return () => unlinkSync(path);
}

function copyCommit(original) {
  const lookup = ref => git(original, ['show-ref', '--hash', '--verify', '--', ref], [0, 128]).trim();
  const develop = lookup('refs/heads/develop');
  if (develop) return develop;
  const origin = git(original, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], [0, 1]).trim();
  const prefix = 'refs/remotes/origin/';
  const candidates = origin.startsWith(prefix)
    ? ['refs/heads/' + origin.slice(prefix.length)]
    : ['refs/heads/main', 'refs/heads/master'];
  const defaults = candidates.map(lookup).filter(Boolean);
  if (defaults.length !== 1) throw new Error('Could not identify develop or a unique local default branch.');
  return defaults[0];
}

function readTree(original, commit) {
  const entries = new Map();
  for (const record of git(original, ['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, , oid] = record.slice(0, tab).split(' ');
    const name = record.slice(tab + 1);
    if (tab === -1 || !isObjectId(oid) || name.includes('\uFFFD')) throw new Error('Unsupported Git tree entry.');
    entries.set(name, { mode, oid });
  }
  return entries;
}

function writeBaseline(original, cwd, baseline) {
  for (const [name, { oid, mode }] of baseline) {
    const parts = name.split('/');
    if (parts.some(part => !part || /^\.{1,2}$|^\.git$/i.test(part)
      || (process.platform === 'win32' && (/[\\:"<>|?*]|[ .]$/.test(part)
        || /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part))))) {
      throw new Error('Unsupported Git path in file-only workspace: ' + name);
    }
    const destination = join(cwd, ...parts);
    mkdirSync(dirname(destination), { recursive: true });
    const parent = localDirectory(realpathSync(dirname(destination)));
    if (!isWithin(cwd, parent)) throw new Error('File-only path escapes worker workspace.');
    const fd = openSync(destination, 'wx', mode === '100755' ? 0o755 : 0o644);
    try {
      git(original, ['cat-file', 'blob', oid], [0], { stdio: ['ignore', fd, 'pipe'] });
    } finally {
      closeSync(fd);
    }
  }
}

function isWithin(directory, path) {
  const fromDirectory = relative(directory, path);
  return !isAbsolute(fromDirectory) && fromDirectory !== '..' && !fromDirectory.startsWith('..' + sep);
}

function isObjectId(value) {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
}
