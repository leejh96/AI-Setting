import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

const prefix = 'codex-agy-workspace-';
const namePattern = /^codex-agy-workspace-[a-z0-9]{6}$/i;
const manifest = 'workspace.json';
const gitPathOverrides = new Set(['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']);
const workspaceRoot = (jobs) => join(realpathSync(dirname(jobs)), 'workspaces');

function git(cwd, args, allowed = [0]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !gitPathOverrides.has(name.toUpperCase())));
  const result = spawnSync('git', ['-C', cwd, ...args], {
    env, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!allowed.includes(result.status)) throw new Error(result.stderr.trim() || 'Git workspace check failed.');
  return result;
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

export function prepareWorkspace(jobs, target) {
  let original;
  let commit;
  if (target !== undefined) {
    if (!isAbsolute(target)) throw new Error('Pass an absolute original Git worktree path.');
    original = realpathSync(target);
    const top = git(original, ['rev-parse', '--show-toplevel']).stdout.trim();
    if (!sameDirectory(top, original)) throw new Error('Pass the root of the original Git worktree.');
    commit = git(original, ['rev-parse', '--verify', 'HEAD^{commit}']).stdout.trim();
  }
  mkdirSync(dirname(jobs), { recursive: true, mode: 0o700 });
  const root = workspaceRoot(jobs);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const storage = localDirectory(root);
  const directory = mkdtempSync(join(storage, prefix));
  const cwd = join(directory, 'work');
  try {
    if (original) git(original, ['worktree', 'add', '--detach', '--', cwd, commit]);
    else mkdirSync(cwd);
  } catch (error) {
    if (!readdirSync(directory).length) rmdirSync(directory);
    else throw new Error(`Could not prepare ${cwd}: ${error.message}`);
    throw error;
  }
  const { dev, ino } = lstatSync(cwd);
  writeFileSync(join(directory, manifest), JSON.stringify({ original, dev, ino }), { flag: 'wx', mode: 0o600 });
  return { cwd, kind: original ? 'git' : 'temporary', ...(original ? { original } : {}) };
}

export function managedWorkspace(cwd, jobs) {
  const directory = dirname(cwd);
  if (basename(cwd) !== 'work' || !namePattern.test(basename(directory)) || basename(dirname(directory)) !== 'workspaces'
      || !lstatSync(dirname(jobs), { throwIfNoEntry: false }) || dirname(directory) !== workspaceRoot(jobs)) return null;
  localDirectory(directory);
  localDirectory(cwd);
  const path = join(directory, manifest);
  if (!lstatSync(path).isFile()) throw new Error('Invalid worker workspace record.');
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (!sameEntry(lstatSync(cwd), record) || (record.original !== undefined && !isAbsolute(record.original))) {
    throw new Error('Worker workspace identity changed.');
  }
  return { cwd, directory, original: record.original, dev: record.dev, ino: record.ino };
}

export function lockWorkspace(workspace) {
  const path = join(workspace.directory, 'operation.lock');
  writeFileSync(path, '', { flag: 'wx', mode: 0o600 });
  return () => unlinkSync(path);
}

function digest(path, expected) {
  const fd = openSync(path, 'r');
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const current = fstatSync(fd);
    if (!current.isFile() || !sameEntry(current, expected) || current.size !== expected.size || current.mtimeMs !== expected.mtimeMs) {
      throw new Error('A result file changed during verification: ' + path);
    }
    let size;
    while ((size = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size));
    const after = fstatSync(fd);
    if (after.size !== expected.size || after.mtimeMs !== expected.mtimeMs) throw new Error('A result file changed during verification: ' + path);
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

function verifyFiles(directory, published, files, directories) {
  localDirectory(directory);
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const other = published && join(published, name);
    const info = lstatSync(path);
    if (info.isDirectory()) verifyFiles(path, other, files, directories);
    else {
      if (!info.isFile() || !other || realpathSync(other) !== other) throw new Error('Missing or unsupported published result: ' + path);
      const copy = lstatSync(other);
      if (!copy.isFile() || copy.size !== info.size || (copy.mode & 0o111) !== (info.mode & 0o111) || digest(path, info) !== digest(other, copy)) {
        throw new Error('Published result differs: ' + path);
      }
      files.push({ path, other, info });
    }
  }
  directories.push(directory);
}

export function removeWorkspace(workspace, published) {
  const { cwd, original } = workspace;
  if (!sameEntry(lstatSync(localDirectory(cwd)), workspace)) throw new Error('Worker workspace identity changed.');
  if (readdirSync(workspace.directory).some((name) => !['work', manifest, 'operation.lock'].includes(name))) {
    throw new Error('Unexpected files exist outside the worker workspace.');
  }
  if (original) {
    if (published !== undefined) throw new Error('Git workspaces use their recorded original worktree.');
    localDirectory(original);
    for (const path of [cwd, original]) {
      const top = git(path, ['rev-parse', '--show-toplevel']).stdout.trim();
      if (!sameDirectory(top, path)) throw new Error('Git worktree path changed: ' + path);
    }
    const commonDir = (path) => git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim();
    if (!sameDirectory(commonDir(cwd), commonDir(original))) throw new Error('Original Git repository changed.');
    const head = git(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']).stdout.trim();
    if (git(original, ['merge-base', '--is-ancestor', head, 'HEAD'], [0, 1]).status !== 0) {
      throw new Error('The worker commit is not in the original worktree history.');
    }
    const tracked = git(cwd, ['ls-files', '-v', '-z']).stdout.split('\0');
    if (tracked.some((entry) => /^[a-zS] /.test(entry))
        || git(cwd, ['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching']).stdout) {
      throw new Error('The worker worktree contains local changes or ignored files.');
    }
    git(original, ['worktree', 'remove', '--', cwd]);
  } else {
    if (published !== undefined) {
      if (!isAbsolute(published)) throw new Error('Pass an absolute published result directory.');
      published = localDirectory(realpathSync(published));
      const fromStorage = relative(dirname(dirname(workspace.directory)), published);
      if (!fromStorage || (!isAbsolute(fromStorage) && fromStorage !== '..' && !fromStorage.startsWith('..' + sep))) {
        throw new Error('Published results must be outside managed worker storage.');
      }
    }
    const files = [];
    const directories = [];
    verifyFiles(cwd, published, files, directories);
    for (const { path, other, info } of files) {
      const current = lstatSync(path);
      const copy = lstatSync(other);
      if (realpathSync(path) !== path || realpathSync(other) !== other || !copy.isFile() || !sameEntry(current, info)
          || (current.mode & 0o111) !== (copy.mode & 0o111) || digest(path, info) !== digest(other, copy)) {
        throw new Error('Result files changed before cleanup: ' + path);
      }
      unlinkSync(path);
    }
    for (const directory of directories) rmdirSync(localDirectory(directory));
  }
  unlinkSync(join(workspace.directory, manifest));
}
