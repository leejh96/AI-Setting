import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync, closeSync, constants, copyFileSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, readlinkSync, readdirSync, readSync, realpathSync, renameSync, rmSync,
  rmdirSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { git, isWithin, prepareWorkspace } from './workspace.mjs';

function identity(path) {
  const info = lstatSync(path, { bigint: true });
  if (!info.isDirectory() || realpathSync(path) !== path) throw new Error('Directory changed: ' + path);
  return { dev: String(info.dev), ino: String(info.ino) };
}

function gitState(path) {
  return {
    head: git(path, ['rev-parse', '--verify', 'HEAD^{commit}']).trim(),
    branch: git(path, ['rev-parse', '--symbolic-full-name', 'HEAD']).trim(),
  };
}

function gitRoot(path) {
  for (let current = path; ; current = dirname(current)) {
    if (lstatSync(join(current, '.git'), { throwIfNoEntry: false })) {
      if (current !== path || realpathSync(git(path, ['rev-parse', '--show-toplevel']).trim()) !== path) {
        throw new Error('Pass the root of the original Git worktree.');
      }
      return true;
    }
    if (dirname(current) === current) return false;
  }
}

function hashFile(path, info) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) {
      throw new Error('File changed during inspection: ' + path);
    }
    let size;
    while ((size = readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, size));
    const after = fstatSync(fd);
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) {
      throw new Error('File changed during inspection: ' + path);
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

function entry(path) {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) return null;
  if (info.isDirectory()) return { type: 'directory' };
  if (info.isSymbolicLink()) return { type: 'link', target: readlinkSync(path) };
  if (!info.isFile()) throw new Error('Unsupported file type: ' + path);
  return { type: 'file', hash: hashFile(path, info), mode: info.mode & 0o777 };
}

function parts(path) {
  const segments = path.split('/');
  if (segments.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'
    || (process.platform === 'win32' && /[\\:]/.test(part)))) throw new Error('Invalid result path: ' + path);
  return segments;
}

function at(root, name) {
  const segments = parts(name);
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    parent = join(parent, segment);
    const info = lstatSync(parent, { throwIfNoEntry: false });
    if (!info?.isDirectory()) return null;
  }
  return entry(join(root, ...segments));
}

function snapshot(root, gitWorkspace = false) {
  const entries = new Map();
  function walk(directory, prefix) {
    for (const name of readdirSync(directory).sort()) {
      if (!prefix && gitWorkspace && name === '.git') continue;
      const key = prefix + name;
      parts(key);
      const path = join(directory, name);
      const info = entry(path);
      if (!info) throw new Error('File disappeared during inspection: ' + path);
      entries.set(key, info);
      if (info.type === 'directory') walk(path, key + '/');
    }
  }
  identity(root);
  walk(root, '');
  return entries;
}

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const keyFor = entries => createHash('sha256').update(JSON.stringify([...entries])).digest('hex');
const readRecord = (job, name) => JSON.parse(readFileSync(join(job, name), 'utf8'));

function writeRecord(job, name, record) {
  const temporary = join(job, name + '.' + randomUUID());
  writeFileSync(temporary, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    renameSync(temporary, join(job, name));
  } finally {
    rmSync(temporary, { force: true });
  }
}

function copyEntry(source, target, info) {
  if (info.type === 'directory') mkdirSync(target);
  else if (info.type === 'link') symlinkSync(info.target, target);
  else {
    copyFileSync(source, target, constants.COPYFILE_EXCL);
    chmodSync(target, info.mode);
  }
}

function copyTree(source, target, entries) {
  for (const [name, info] of entries) copyEntry(join(source, name), join(target, name), info);
  if (keyFor(snapshot(target)) !== keyFor(entries)) throw new Error('Copied result could not be verified.');
}

export function prepareResult(job, target, copy) {
  if (target !== undefined && !isAbsolute(target)) throw new Error('Pass an absolute original folder.');
  const original = target === undefined ? null : realpathSync(target);
  const originalIdentity = original ? identity(original) : null;
  if (original && isWithin(original, job)) throw new Error('The temporary job must be outside the original folder.');
  const isGit = original && gitRoot(original);
  if (copy && !isGit) throw new Error('--copy requires a Git worktree. Pass a regular folder without --copy.');
  const originalGit = isGit ? gitState(original) : null;
  const originalFiles = original && !isGit ? snapshot(original) : null;
  const workspace = prepareWorkspace(job, { original: isGit ? original : undefined, head: originalGit?.head, copy });
  if (originalFiles) copyTree(original, workspace.cwd, originalFiles);
  const baseline = snapshot(workspace.cwd, workspace.kind === 'git');
  writeRecord(job, 'baseline.json', { original, originalIdentity, originalGit, entries: [...baseline] });
  return { ...workspace, ...(original ? { original } : {}) };
}

export function reviewResult(job, workspace, state) {
  const result = snapshot(workspace.cwd, state.kind === 'git');
  const baselinePath = join(job, 'baseline.json');
  const baseline = lstatSync(baselinePath, { throwIfNoEntry: false })
    ? readRecord(job, 'baseline.json') : null;
  const before = new Map(baseline?.entries ?? []);
  const changes = [...new Set([...before.keys(), ...result.keys()])].flatMap(name => {
    const old = before.get(name) ?? null;
    const current = result.get(name) ?? null;
    return equal(old, current) ? [] : [{ name, before: old, after: current }];
  });
  const review = {
    id: randomUUID(), turn: state.turn, result: keyFor(result),
    original: baseline?.original ?? null, changes,
  };
  writeRecord(job, 'review.json', review);
  return {
    reviewId: review.id, original: review.original,
    changes: changes.map(({ name, before, after }) => ({ path: name, action: !before ? 'add' : !after ? 'delete' : 'modify' })),
  };
}

function verifyOriginal(baseline) {
  const root = baseline.original;
  if (!equal(identity(root), baseline.originalIdentity)) throw new Error('The original folder was replaced.');
  if (baseline.originalGit && !equal(gitState(root), baseline.originalGit)) {
    throw new Error('The original Git branch or commit changed. Results were preserved.');
  }
  return root;
}

function verifyWorkerGit(workspace) {
  const common = path => realpathSync(git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim());
  const top = realpathSync(git(workspace.cwd, ['rev-parse', '--show-toplevel']).trim());
  if (top !== workspace.cwd || common(workspace.cwd) !== common(workspace.original)) {
    throw new Error('The worker Git worktree was replaced.');
  }
}

function verifyApplied(root, changes) {
  for (const { name, after } of changes) {
    if (!equal(at(root, name), after)) throw new Error('Original result differs at ' + name);
  }
}

function verifyLinkTargets(job, cwd, destination, entries) {
  for (const [name, info] of entries) {
    if (info?.type !== 'link') continue;
    const oldTarget = resolve(dirname(join(cwd, name)), info.target);
    const newTarget = resolve(dirname(join(destination, name)), info.target);
    if (isWithin(job, newTarget) || (isWithin(job, oldTarget) && !isWithin(cwd, oldTarget))) {
      throw new Error('Result link points into the temporary job and would break after cleanup: ' + name);
    }
    const movesWithResult = isWithin(cwd, oldTarget) && isWithin(destination, newTarget)
      && relative(cwd, oldTarget) === relative(destination, newTarget);
    if (oldTarget !== newTarget && !movesWithResult) {
      throw new Error('Result link would point to a different target after relocation: ' + name);
    }
  }
}

function replaceEntry(root, name, expected, next, source) {
  const target = join(root, ...parts(name));
  const check = () => {
    if (!equal(at(root, name), expected)) throw new Error('Original changed during apply: ' + name);
    const parent = dirname(target);
    if (!lstatSync(parent, { throwIfNoEntry: false })?.isDirectory() || realpathSync(parent) !== parent) {
      throw new Error('Original parent changed during apply: ' + name);
    }
  };
  check();
  if (!next) {
    if (expected.type === 'directory') rmdirSync(target);
    else unlinkSync(target);
  } else if (next.type === 'directory') {
    mkdirSync(target);
  } else {
    const staging = mkdtempSync(join(dirname(target), '.codex-agy-'));
    try {
      const file = join(staging, 'entry');
      copyEntry(source, file, next);
      if (!equal(entry(file), next)) throw new Error('Result changed during apply: ' + name);
      check();
      if (expected) renameSync(file, target);
      else if (next.type === 'file') linkSync(file, target);
      else symlinkSync(next.target, target);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
}

function applyChanges(job, workspace, review, baseline) {
  const root = verifyOriginal(baseline);
  const pending = review.changes.filter(({ name, before, after }) => {
    const current = at(root, name);
    if (equal(current, after)) return false;
    if (!equal(current, before)) throw new Error('Original has conflicting changes at ' + name);
    return true;
  });
  const removing = new Set(pending.filter(({ before, after }) => before && before.type !== after?.type)
    .map(({ name }) => name));
  for (const { name, before } of pending) {
    if (before?.type === 'directory' && removing.has(name)
      && readdirSync(join(root, name)).some(child => !removing.has(name + '/' + child))) {
      throw new Error('Original directory contains unrelated files: ' + name);
    }
  }

  const recovery = mkdtempSync(join(job, 'apply-backup-'));
  const steps = [];
  const replace = (...args) => {
    if (!equal(identity(root), baseline.originalIdentity)) throw new Error('The original folder was replaced.');
    replaceEntry(root, ...args);
  };
  let keepRecovery = false;
  try {
    for (const [index, change] of pending.entries()) {
      if (change.before?.type === 'file') {
        change.backup = join(recovery, String(index));
        copyEntry(join(root, change.name), change.backup, change.before);
        if (!equal(entry(change.backup), change.before)) throw new Error('Original changed during backup: ' + change.name);
      }
    }
    const remove = pending.filter(change => removing.has(change.name)).sort((a, b) => b.name.length - a.name.length);
    for (const { name, before, backup } of remove) {
      replace(name, before, null);
      steps.push({ name, expected: null, next: before, source: backup });
    }
    const write = pending.filter(change => change.after).sort((a, b) => a.name.length - b.name.length);
    for (const { name, before, after, backup } of write) {
      const expected = removing.has(name) ? null : before;
      replace(name, expected, after, join(workspace.cwd, name));
      steps.push({ name, expected: after, next: expected, source: backup });
    }
    verifyOriginal(baseline);
    verifyApplied(root, review.changes);
  } catch (error) {
    const failures = [];
    for (const step of steps.reverse()) {
      try {
        replace(step.name, step.expected, step.next, step.source);
      } catch (failure) {
        failures.push(failure.message);
      }
    }
    if (failures.length) {
      keepRecovery = true;
      writeRecord(recovery, 'recovery.json', { root, steps });
      throw new Error(`${error.message} Rollback incomplete. Backups: ${recovery}. ${failures.join(' ')}`);
    }
    throw error;
  } finally {
    if (!keepRecovery) rmSync(recovery, { recursive: true, force: true });
  }
}

function applyResult(job, workspace, review) {
  const baseline = readRecord(job, 'baseline.json');
  const lock = join(realpathSync(tmpdir()), 'codex-agy-apply-' + keyFor(Object.entries(baseline.originalIdentity)));
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another ACP apply is active or interrupted. Inspect ' + lock);
    throw error;
  }
  try {
    applyChanges(job, workspace, review, baseline);
  } finally {
    rmdirSync(lock);
  }
}

function hasGitWorkspace(job, workspace) {
  const records = git(workspace.original, ['worktree', 'list', '--porcelain', '-z']).split('\0\0');
  const entries = records.map(record => record.split('\0')[0]).filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length)).filter(path => isWithin(job, path));
  if (entries.some(path => path !== workspace.cwd)) throw new Error('Additional Git worktrees exist under the job.');
  return entries.length !== 0;
}

export function removeGitWorkspace(job, workspace) {
  if (hasGitWorkspace(job, workspace)) {
    verifyWorkerGit(workspace);
    git(workspace.original, ['worktree', 'remove', '--force', '--', workspace.cwd]);
  }
  if (lstatSync(workspace.cwd, { throwIfNoEntry: false }) || hasGitWorkspace(job, workspace)) {
    throw new Error('Git worktree cleanup could not be verified.');
  }
}

export function finalizeResult(job, workspace, state, id, decision) {
  const review = readRecord(job, 'review.json');
  if (review.id !== id || review.turn !== state.turn) throw new Error('Review is stale. Review the current results before asking again.');
  const recordPath = join(job, 'finalized.json');
  if (lstatSync(recordPath, { throwIfNoEntry: false })) {
    const outcome = readRecord(job, 'finalized.json');
    if (outcome.decision !== '--apply') throw new Error('Unsupported finalization record. Job was preserved.');
    if (outcome.id !== id || outcome.decision !== decision) throw new Error('Retry finish with the original review and decision.');
  } else {
    verifyReviewedWorkspace(job, workspace, state, review);
    if (decision === '--keep') return { original: review.original, kept: workspace.cwd };
    if (!review.original) throw new Error('This job has no recorded original baseline. Keep the result in its workspace.');
    verifyLinkTargets(job, workspace.cwd, review.original, review.changes.map(({ name, after }) => [name, after]));
    applyResult(job, workspace, review);
    writeRecord(job, 'finalized.json', { id, decision, original: review.original });
  }
  verifyApplied(verifyOriginal(readRecord(job, 'baseline.json')), review.changes);
  if (lstatSync(workspace.cwd, { throwIfNoEntry: false })
    && keyFor(snapshot(workspace.cwd, state.kind === 'git')) !== review.result) {
    throw new Error('Worker files changed before cleanup. Results were preserved.');
  }
  if (state.kind === 'git') removeGitWorkspace(job, workspace);
  return { original: review.original };
}

function verifyReviewedWorkspace(job, workspace, state, review) {
  if (state.kind === 'git') {
    if (!hasGitWorkspace(job, workspace)) throw new Error('The worker Git worktree is no longer registered.');
    verifyWorkerGit(workspace);
  }
  if (keyFor(snapshot(workspace.cwd, state.kind === 'git')) !== review.result) {
    throw new Error('Worker files changed after review. Review them and ask again.');
  }
}
