import { spawnSync } from 'node:child_process';
import { Buffer, isUtf8 } from 'node:buffer';
import { chmodSync, closeSync, fchmodSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import process from 'node:process';

const prefix = 'codex-agy-workspace-';
const namePattern = /^codex-agy-workspace-[a-z0-9]{6}$/i;
const manifest = 'workspace.json';
const gitPathOverrides = new Set(['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_NAMESPACE']);
export const canonicalPath = process.platform === 'win32' ? realpathSync.native : realpathSync;
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

function localDirectory(path) {
  if (!isAbsolute(path) || !lstatSync(path).isDirectory() || realpathSync(path) !== path) {
    throw new Error('Expected a canonical local directory: ' + path);
  }
  return path;
}

export function prepareWorkspace(job, { original, head, copy }) {
  const baseline = copy ? readTree(original, copyCommit(original)) : undefined;
  if (baseline && [...baseline.values()].some(entry => !['100644', '100755'].includes(entry.mode))) {
    throw new Error('File-only workspaces require a tree of regular files.');
  }
  const root = workspaceRoot(job);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const storage = localDirectory(root);
  const directory = mkdtempSync(join(storage, prefix));
  const cwd = join(directory, 'work');
  const linked = original && !copy;
  try {
    if (linked) git(original, ['worktree', 'add', '--detach', '--', cwd, head]);
    else {
      mkdirSync(cwd);
      if (baseline) writeBaseline(original, cwd, baseline);
    }
    const { dev, ino } = lstatSync(cwd);
    writeFileSync(join(directory, manifest), JSON.stringify({ original, dev, ino }), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    try {
      const registered = linked && registeredWorktrees(original).find(path => [cwd, join(canonicalPath(directory), 'work')]
        .some(expected => relative(path, expected) === ''));
      if (registered) git(original, ['worktree', 'remove', '--force', '--', registered]);
      rmSync(directory, { recursive: true, force: true });
      if (!readdirSync(storage).length) rmdirSync(storage);
    } catch (cleanupError) {
      throw new Error(`${error.message} Prepare cleanup failed at ${cwd}: ${cleanupError.message}`, { cause: cleanupError });
    }
    throw error;
  }
  return { cwd, kind: linked ? 'git' : 'temporary' };
}

export function registeredWorktrees(original) {
  return git(original, ['worktree', 'list', '--porcelain', '-z']).split('\0\0')
    .map(record => record.split('\0')[0]).filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length));
}

export function removeFileWorkspace(path) {
  function allowRemoval(directory) {
    const info = lstatSync(directory, { throwIfNoEntry: false });
    if (!info?.isDirectory()) return;
    if ((info.mode & 0o700) !== 0o700) chmodSync(directory, (info.mode & 0o7777) | 0o700);
    for (const child of readdirSync(directory, { withFileTypes: true })) {
      if (child.isDirectory()) allowRemoval(join(directory, child.name));
    }
  }
  if (process.platform !== 'win32') allowRemoval(path);
  rmSync(path, { recursive: true, force: true });
}

export function managedWorkspace(cwd, job, { cleaning = false } = {}) {
  const directory = dirname(cwd);
  if (basename(cwd) !== (cleaning ? 'cleanup-work' : 'work')
    || !namePattern.test(basename(directory)) || dirname(directory) !== workspaceRoot(job)) return null;
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
  try {
    writeFileSync(path, JSON.stringify({ pid: process.pid }) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Worker operation is active or interrupted. Inspect lock: ' + path, { cause: error });
    throw error;
  }
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
    const permissions = mode === '100755' ? 0o755 : 0o644;
    const fd = openSync(destination, 'wx', permissions);
    try {
      git(original, ['cat-file', 'blob', oid], [0], { stdio: ['ignore', fd, 'pipe'] });
      if (process.platform !== 'win32') fchmodSync(fd, permissions);
    } finally {
      closeSync(fd);
    }
    preserveCheckoutLineEndings(original, parts, destination);
  }
}

function preserveCheckoutLineEndings(original, parts, destination) {
  const unavailable = error => ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code);
  let source = original;
  let size;
  try {
    for (const [index, part] of parts.entries()) {
      source = join(source, part);
      const info = lstatSync(source);
      if (index === parts.length - 1 ? !info.isFile() : !info.isDirectory()) return;
      size = info.size;
    }
  } catch (error) {
    if (unavailable(error)) return;
    throw error;
  }
  const bytes = lstatSync(destination).size;
  // Limit the in-memory conversion to text files and avoid reading equal-size binaries twice.
  if (bytes >= size || size > bytes * 2 || size > 8 * 1024 * 1024) return;
  const committed = readFileSync(destination);
  if (committed.includes(0) || committed.includes(13) || !committed.includes(10) || !isUtf8(committed)) return;
  const checkout = Buffer.from(committed.toString('utf8').replaceAll('\n', '\r\n'));
  let current;
  try {
    current = readFileSync(source);
  } catch (error) {
    if (unavailable(error)) return;
    throw error;
  }
  if (current.equals(checkout)) writeFileSync(destination, checkout);
}

export function isWithin(directory, path) {
  const fromDirectory = relative(directory, path);
  return !isAbsolute(fromDirectory) && fromDirectory !== '..' && !fromDirectory.startsWith('..' + sep);
}

function isObjectId(value) {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
}
