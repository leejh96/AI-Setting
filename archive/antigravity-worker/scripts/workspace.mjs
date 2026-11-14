import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

const prefix = 'codex-agy-workspace-';
const namePattern = /^codex-agy-workspace-[a-z0-9]{6}$/i;
const manifest = 'workspace.json';
const cleanupRecord = 'finish.json';
const gitPathOverrides = new Set(['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']);
const workspaceRoot = (jobs) => join(realpathSync(dirname(jobs)), 'workspaces');

function git(cwd, args, allowed = [0], options = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !gitPathOverrides.has(name.toUpperCase())));
  const result = spawnSync('git', ['-C', cwd, ...args], {
    env, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, ...options,
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

export function prepareWorkspace(jobs, target, { copy = false } = {}) {
  let original;
  let commit;
  if (target !== undefined) {
    if (!isAbsolute(target)) throw new Error('Pass an absolute original Git worktree path.');
    original = realpathSync(target);
    const top = git(original, ['rev-parse', '--show-toplevel']).stdout.trim();
    if (!sameDirectory(top, original)) throw new Error('Pass the root of the original Git worktree.');
    commit = copy ? integrationBranches(original)[0].commit : git(original, ['rev-parse', '--verify', 'HEAD^{commit}']).stdout.trim();
  }
  if (copy && !original) throw new Error('A Git repository is required for a file-only workspace.');
  const baseline = copy ? readTree(original, commit) : undefined;
  if (baseline && [...baseline.values()].some(entry => !['100644', '100755'].includes(entry.mode))) {
    throw new Error('File-only workspaces require a tree of regular files.');
  }
  mkdirSync(dirname(jobs), { recursive: true, mode: 0o700 });
  const root = workspaceRoot(jobs);
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
  writeFileSync(join(directory, manifest), JSON.stringify({ original, dev, ino, ...(copy ? { baseline: commit } : {}) }), { flag: 'wx', mode: 0o600 });
  return { cwd, kind: original && !copy ? 'git' : 'temporary', ...(original ? { original } : {}) };
}

export function managedWorkspace(cwd, jobs, { finishing = false } = {}) {
  const directory = dirname(cwd);
  if (basename(cwd) !== 'work' || !namePattern.test(basename(directory)) || basename(dirname(directory)) !== 'workspaces'
      || !lstatSync(dirname(jobs), { throwIfNoEntry: false }) || dirname(directory) !== workspaceRoot(jobs)) return null;
  if (finishing && !lstatSync(directory, { throwIfNoEntry: false })) return null;
  localDirectory(directory);
  const path = join(directory, manifest);
  if (!lstatSync(path).isFile()) throw new Error('Invalid worker workspace record.');
  const record = JSON.parse(readFileSync(path, 'utf8'));
  const entry = lstatSync(cwd, { throwIfNoEntry: false });
  if ((entry ? !sameEntry(lstatSync(localDirectory(cwd)), record) : !finishing || !readCleanup(directory))
      || (record.original !== undefined && !isAbsolute(record.original))) {
    throw new Error('Worker workspace identity changed.');
  }
  return { cwd, directory, original: record.original, baseline: record.baseline, dev: record.dev, ino: record.ino };
}

export function lockWorkspace(workspace) {
  const path = join(workspace.directory, 'operation.lock');
  writeFileSync(path, '', { flag: 'wx', mode: 0o600 });
  return () => unlinkSync(path);
}

function digest(path, expected, algorithm, prefix = '') {
  const fd = openSync(path, 'r');
  try {
    const hash = createHash(algorithm).update(prefix);
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

function collectFiles(directory, files, { allowLinks = false } = {}) {
  localDirectory(directory);
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const info = lstatSync(path);
    if (name.toLowerCase() === '.git') throw new Error('Unexpected Git metadata in worker results: ' + path);
    if (info.isDirectory()) collectFiles(path, files, { allowLinks });
    else if (allowLinks && info.isSymbolicLink()) continue;
    else {
      if (!info.isFile()) throw new Error('Unsupported file in worker results: ' + path);
      files.push({ path, info });
    }
  }
}

function isWithin(directory, path) {
  const fromDirectory = relative(directory, path);
  return !isAbsolute(fromDirectory) && fromDirectory !== '..' && !fromDirectory.startsWith('..' + sep);
}

function removeDetachedDirectory(directory, expected) {
  function checkDirectory() {
    if (!sameEntry(lstatSync(localDirectory(directory)), expected)) {
      throw new Error('Worker directory changed during cleanup: ' + directory);
    }
  }

  checkDirectory();
  for (const name of readdirSync(directory)) {
    checkDirectory();
    const path = join(directory, name);
    if (name.toLowerCase() === '.git') {
      throw new Error('Found unexpected Git metadata during cleanup: ' + path);
    }
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || entry.isFile()) {
      // Unlink Windows junctions and symlinks without opening their targets.
      unlinkSync(path);
    } else if (entry.isDirectory()) {
      removeDetachedDirectory(path, entry);
    } else {
      throw new Error('Unsupported worker file during cleanup: ' + path);
    }
  }
  checkDirectory();
  rmdirSync(directory);
}

function worktrees(original) {
  const entries = git(original, ['worktree', 'list', '--porcelain', '-z']).stdout
    .split('\0\0').filter(Boolean).map(record => {
      const [location, ...attributes] = record.split('\0');
      return {
        path: location.startsWith('worktree ') ? location.slice('worktree '.length) : '',
        branch: attributes.find(field => field.startsWith('branch '))?.slice('branch '.length),
      };
    });
  if (!entries.length || entries.some(entry => !isAbsolute(entry.path))) {
    throw new Error('Could not verify Git worktree registration.');
  }
  return entries;
}

function integrationBranches(original) {
  const origin = git(original, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], [0, 1]).stdout.trim();
  const prefix = 'refs/remotes/origin/';
  const candidates = origin.startsWith(prefix)
    ? ['refs/heads/' + origin.slice(prefix.length)]
    : ['refs/heads/main', 'refs/heads/master'];
  function lookup(ref) {
    const result = git(original, ['show-ref', '--hash', '--verify', '--', ref], [0, 128]);
    return result.status === 0 ? { ref, commit: result.stdout.trim() } : undefined;
  }
  const develop = lookup('refs/heads/develop');
  const defaults = candidates.map(lookup).filter(Boolean);
  const primary = defaults.length === 1 ? defaults[0] : undefined;
  const branches = [develop, primary?.ref !== develop?.ref ? primary : undefined].filter(Boolean);
  if (!branches.length) throw new Error('Could not identify develop or a unique local main branch.');
  return branches;
}

function verifyIntegration(branches, mismatch) {
  let reason;
  for (const branch of branches) {
    reason = mismatch(branch);
    if (!reason) return branch;
  }
  throw new Error('Worker results are not on a local integration branch: ' + reason);
}

function readTree(original, commit) {
  const entries = new Map();
  for (const record of git(original, ['ls-tree', '-r', '-z', commit]).stdout.split('\0').filter(Boolean)) {
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

function compareTreeChanges(baseline, result, main) {
  let changed = false;
  const equal = (a, b) => a?.oid === b?.oid && a?.mode === b?.mode;
  for (const name of new Set([...baseline.keys(), ...result.keys()])) {
    if (equal(baseline.get(name), result.get(name))) continue;
    changed = true;
    if (!equal(result.get(name), main.get(name))) {
      return { mismatch: name };
    }
  }
  return { changed };
}

function committedMismatch(original, head, branch) {
  if (git(original, ['merge-base', '--is-ancestor', head, branch.commit], [0, 1]).status === 0) return;
  const common = git(original, ['merge-base', '--all', head, branch.commit], [0, 1]);
  const base = common.stdout.trim().split(/\r?\n/);
  if (base.length !== 1 || !base[0]) return 'no unique common ancestor';
  const { mismatch, changed } = compareTreeChanges(
    readTree(original, base[0]), readTree(original, head), readTree(original, branch.commit)
  );
  return mismatch ?? (changed ? undefined : 'no matching changes or merged commit');
}

function fileResultTree(workspace, base, options) {
  const { cwd, original } = workspace;
  const algorithm = git(original, ['rev-parse', '--show-object-format']).stdout.trim();
  const files = [];
  collectFiles(cwd, files, options);
  return new Map(files.map(({ path, info }) => {
    const name = relative(cwd, path).split(sep).join('/');
    const mode = process.platform === 'win32' ? base.get(name)?.mode ?? '100644'
      : (info.mode & 0o111) ? '100755' : '100644';
    return [name, { mode, oid: digest(path, info, algorithm, 'blob ' + info.size + '\0') }];
  }));
}

function verifyFileResults(workspace, branches, recorded, hasFiles) {
  const { original, baseline } = workspace;
  if (!isObjectId(baseline)) throw new Error('Missing baseline for file-only worker results.');
  const base = readTree(original, baseline);
  if ([...base.values()].some(entry => !['100644', '100755'].includes(entry.mode))) {
    throw new Error('Unsupported baseline for file-only worker results.');
  }
  const remaining = hasFiles ? fileResultTree(workspace, base) : new Map();
  const expected = recorded ? new Map(Object.entries(recorded.files)) : remaining;
  // Files missing on retry can have been removed by the previous verified finish.
  if (recorded) {
    for (const [name, entry] of remaining) {
      if (expected.get(name)?.oid !== entry.oid || expected.get(name)?.mode !== entry.mode) {
        throw new Error('Worker files changed after verification: ' + name);
      }
    }
  }
  const integration = verifyIntegration(branches, branch =>
    compareTreeChanges(base, expected, readTree(original, branch.commit)).mismatch);
  return { integration, files: Object.fromEntries(expected) };
}

function isObjectId(value) {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
}

function readCleanup(directory) {
  const file = join(directory, cleanupRecord);
  const info = lstatSync(file, { throwIfNoEntry: false });
  if (!info) return;
  if (!info.isFile()) throw new Error('Invalid worker finish record.');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  if (!isObjectId(record.head) || (record.branch !== undefined && !isTaskBranch(record.branch))
      || (record.files !== undefined && (!record.files || typeof record.files !== 'object'
        || Array.isArray(record.files) || Object.values(record.files).some(entry =>
          !entry || !isObjectId(entry.oid) || !['100644', '100755'].includes(entry.mode))))) {
    throw new Error('Invalid worker finish record.');
  }
  return record;
}

function isTaskBranch(branch) {
  return typeof branch === 'string' && /^refs\/heads\/feature\/[^\s]+$/.test(branch);
}

function removeTaskBranch(original, branch, head, integration) {
  if (!branch) return;
  if (integrationBranches(original).some(candidate => candidate.ref === branch)) {
    return { retainedBranch: branch.slice('refs/heads/'.length) };
  }
  const current = git(original, ['show-ref', '--hash', '--verify', '--', branch], [0, 128]);
  if (current.status !== 0) return;
  if (current.stdout.trim() !== head || worktrees(original).some(entry => entry.branch === branch)) {
    return { retainedBranch: branch.slice('refs/heads/'.length) };
  }
  // Atomically require both refs to still point at the commits used by the verification.
  const input = 'option no-deref\nverify ' + integration.ref + ' ' + integration.commit + '\ndelete ' + branch + ' ' + head + '\n';
  git(original, ['update-ref', '--stdin'], [0], { input });
  return { removedBranch: branch.slice('refs/heads/'.length) };
}

export function removeWorkspace(workspace) {
  const { cwd, directory, original, baseline } = workspace;
  if (readdirSync(directory).some(name => !['work', manifest, cleanupRecord, 'operation.lock'].includes(name))) {
    throw new Error('Unexpected files exist outside the worker workspace.');
  }
  const entry = lstatSync(cwd, { throwIfNoEntry: false });
  if (entry && !sameEntry(lstatSync(localDirectory(cwd)), workspace)) {
    throw new Error('Worker workspace identity changed.');
  }
  if (!original) throw new Error('Missing Git repository and baseline. Worker files were preserved.');
  localDirectory(original);
  const top = git(original, ['rev-parse', '--show-toplevel']).stdout.trim();
  if (!sameDirectory(top, original) || isWithin(directory, original)) {
    throw new Error('Original Git worktree is no longer at the recorded path.');
  }
  const branches = integrationBranches(original);
  const canonicalDirectory = realpathSync.native(directory);
  const registered = worktrees(original).filter(item =>
    isWithin(directory, item.path) || isWithin(canonicalDirectory, item.path));
  const link = lstatSync(join(cwd, '.git'), { throwIfNoEntry: false });
  const recorded = readCleanup(directory);
  let proof = recorded;
  let retainedBranch;
  let integration;

  if (link) {
    if (baseline || !link.isFile() || registered.length !== 1 || !sameDirectory(cwd, registered[0].path)) {
      throw new Error('Could not verify the worker Git worktree.');
    }
    const workerTop = git(cwd, ['rev-parse', '--show-toplevel']).stdout.trim();
    if (!sameDirectory(workerTop, cwd)) throw new Error('Worker Git worktree path changed.');
    const commonDir = path => git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim();
    if (!sameDirectory(commonDir(cwd), commonDir(original))) throw new Error('Original Git repository changed.');
    const branch = registered[0].branch;
    if (branches.some(candidate => candidate.ref === branch)) {
      throw new Error('An integration branch is checked out in the worker worktree.');
    }
    const tracked = git(cwd, ['ls-files', '-v', '-z']).stdout.split('\0');
    if (tracked.some(item => /^[a-zS] /.test(item))
        || git(cwd, ['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none']).stdout) {
      throw new Error('The worker worktree contains local changes or ignored files.');
    }
    const head = git(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']).stdout.trim();
    integration = verifyIntegration(branches, candidate => committedMismatch(original, head, candidate));
    proof = { head, branch: isTaskBranch(branch) ? branch : undefined };
    if (branch && !proof.branch) retainedBranch = branch.slice('refs/heads/'.length);
    if (recorded && (recorded.head !== proof.head || recorded.branch !== proof.branch || recorded.files)) {
      throw new Error('Worker state changed after cleanup was authorized.');
    }
    if (!recorded) writeFileSync(join(directory, cleanupRecord), JSON.stringify(proof), { flag: 'wx', mode: 0o600 });
    git(original, ['worktree', 'remove', '--', cwd]);
  } else {
    if (registered.length) throw new Error('The worker directory still contains a registered Git worktree.');
    if (baseline && (entry || recorded)) {
      if (recorded && (!recorded.files || recorded.branch)) {
        throw new Error('Missing verified file results for the integration branch.');
      }
      const result = verifyFileResults(workspace, branches, recorded, Boolean(entry));
      integration = result.integration;
      if (!recorded) {
        proof = { head: integration.commit, files: result.files };
        writeFileSync(join(directory, cleanupRecord), JSON.stringify(proof), { flag: 'wx', mode: 0o600 });
      }
    } else {
      if (!recorded) {
        throw new Error('Missing verified worker results for the integration branch. Worker files were preserved.');
      }
      if (recorded.files) throw new Error('Unexpected file-only cleanup record.');
      integration = verifyIntegration(branches, candidate => committedMismatch(original, recorded.head, candidate));
      if (entry) {
        const expected = readTree(original, recorded.head);
        for (const [name, result] of fileResultTree(workspace, expected, { allowLinks: true })) {
          const verified = expected.get(name);
          if (verified?.oid !== result.oid || verified?.mode !== result.mode) {
            throw new Error('Unverified file remains in the worker worktree: ' + name);
          }
        }
      }
    }
    if (entry) removeDetachedDirectory(cwd, workspace);
  }

  if (!integrationBranches(original).some(branch => branch.ref === integration.ref && branch.commit === integration.commit)) {
    throw new Error('The local integration branch changed during cleanup. Retry finish to recheck the branch.');
  }
  const branchResult = removeTaskBranch(original, proof.branch, proof.head, integration);
  unlinkSync(join(directory, manifest));
  unlinkSync(join(directory, cleanupRecord));
  return branchResult ?? (retainedBranch ? { retainedBranch } : undefined);
}
