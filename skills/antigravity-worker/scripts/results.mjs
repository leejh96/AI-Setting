import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync, closeSync, constants, copyFileSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, readlinkSync, readdirSync, readSync, realpathSync, renameSync, rmSync,
  rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { canonicalPath, git, isWithin, managedWorkspace, prepareWorkspace, registeredWorktrees, removeFileWorkspace } from './workspace.mjs';

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
      if (current !== path || relative(canonicalPath(git(path, ['rev-parse', '--show-toplevel']).trim()), canonicalPath(path)) !== '') {
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
  if (info.isDirectory()) return process.platform === 'win32'
    ? { type: 'directory' } : { type: 'directory', mode: info.mode & 0o7777 };
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
  for (const [index, segment] of segments.entries()) {
    const path = join(parent, segment);
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (!info || !readdirSync(parent).includes(segment)) return null;
    if (index === segments.length - 1) return entry(path);
    if (!info.isDirectory()) return null;
    parent = path;
  }
}

function snapshot(root, gitWorkspace = false, directoryModes = true) {
  const entries = new Map();
  function walk(directory, prefix) {
    for (const name of readdirSync(directory).sort()) {
      if (!prefix && gitWorkspace && name === '.git') continue;
      const key = prefix + name;
      parts(key);
      const path = join(directory, name);
      const info = entry(path);
      if (!info) throw new Error('File disappeared during inspection: ' + path);
      if (!directoryModes && info.type === 'directory') delete info.mode;
      entries.set(key, info);
      if (info.type === 'directory') walk(path, key + '/');
    }
  }
  identity(root);
  walk(root, '');
  return entries;
}

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
// Older review records did not record directory permissions.
const matches = (actual, expected) => expected?.type === 'directory' && expected.mode === undefined
  ? actual?.type === 'directory' : equal(actual, expected);
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

function copyEntry(source, target, info, linkType) {
  if (info.type === 'directory') mkdirSync(target);
  else if (info.type === 'link') symlinkSync(info.target, target, linkType);
  else {
    copyFileSync(source, target, constants.COPYFILE_EXCL);
    chmodSync(target, info.mode);
  }
}

function copyTree(source, target, entries) {
  for (const [name, info] of entries) {
    const path = join(source, name);
    copyEntry(path, join(target, name), info, info.type === 'link' ? windowsLinkType(path) : undefined);
  }
  for (const [name, info] of [...entries].reverse()) {
    if (info.type === 'directory' && info.mode !== undefined) chmodSync(join(target, name), info.mode);
  }
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
  const directoryModes = !isGit;
  if (originalFiles) verifyIsolatedLinks(original, originalFiles);
  const workspace = prepareWorkspace(job, { original: isGit ? original : undefined, head: originalGit?.head, copy });
  try {
    if (originalFiles) copyTree(original, workspace.cwd, originalFiles);
    const baseline = snapshot(workspace.cwd, workspace.kind === 'git', directoryModes);
    verifyIsolatedLinks(workspace.cwd, baseline);
    writeRecord(job, 'baseline.json', { original, originalIdentity, originalGit, directoryModes, entries: [...baseline] });
    return { ...workspace, ...(original ? { original } : {}) };
  } catch (error) {
    try {
      if (workspace.kind === 'git') removeGitWorkspace(job, { ...workspace, original });
      removeFileWorkspace(join(job, 'workspaces'));
    } catch (cleanupError) {
      throw new Error(`${error.message} Prepare cleanup failed: ${cleanupError.message}`);
    }
    throw error;
  }
}

function verifyIsolatedLinks(root, entries) {
  for (const [name, info] of entries) {
    if (info.type !== 'link') continue;
    const path = join(root, name);
    if (isAbsolute(info.target) || !isWithin(root, resolve(dirname(path), info.target))) {
      throw new Error('Link points outside the movable workspace: ' + name);
    }
    const target = resolveLink(path);
    if (target && !isWithin(realpathSync.native(root), target)) {
      throw new Error('Link resolves outside the movable workspace: ' + name);
    }
  }
}

function windowsLinkType(path) {
  if (process.platform !== 'win32') return undefined;
  const target = statSync(path, { throwIfNoEntry: false });
  if (!target) throw new Error('Cannot determine the type of a dangling Windows link: ' + path);
  return target.isDirectory() ? 'dir' : 'file';
}

export function reviewResult(job, workspace, state) {
  const baselinePath = join(job, 'baseline.json');
  const baseline = lstatSync(baselinePath, { throwIfNoEntry: false })
    ? readRecord(job, 'baseline.json') : null;
  const result = snapshot(workspace.cwd, state.kind === 'git', baseline?.directoryModes === true);
  const before = new Map(baseline?.entries ?? []);
  const changes = [...new Set([...before.keys(), ...result.keys()])].flatMap(name => {
    const old = before.get(name) ?? null;
    const current = result.get(name) ?? null;
    return equal(old, current) ? [] : [{ name, before: old, after: current }];
  });
  const previous = lstatSync(join(job, 'review.json'), { throwIfNoEntry: false })
    ? readRecord(job, 'review.json') : null;
  const review = {
    turn: state.turn, result: keyFor(result),
    original: baseline?.original ?? null, changes,
  };
  if (baseline?.directoryModes) review.directoryModes = true;
  const { id, ...lastReview } = previous ?? {};
  const reviewId = id && equal(lastReview, review) ? id : randomUUID();
  if (reviewId !== id) writeRecord(job, 'review.json', { id: reviewId, ...review });
  return {
    reviewId, original: review.original,
    changes: changes.map(({ name, before, after }) => ({ path: name, action: !before ? 'add' : !after ? 'delete' : 'modify' })),
  };
}

function verifyOriginal(baseline, { allowNewCommit = false } = {}) {
  const root = baseline.original;
  if (!equal(identity(root), baseline.originalIdentity)) throw new Error('The original folder was replaced.');
  if (baseline.originalGit) {
    const { branch, head } = gitState(root);
    if (branch !== baseline.originalGit.branch
      || (head !== baseline.originalGit.head && (!allowNewCommit || branch === 'HEAD'))) {
      throw new Error('The original Git branch or commit changed. Results were preserved.');
    }
  }
  return root;
}

function verifyWorkerGit(workspace) {
  const common = path => canonicalPath(git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim());
  const top = canonicalPath(git(workspace.cwd, ['rev-parse', '--show-toplevel']).trim());
  if (relative(top, canonicalPath(workspace.cwd)) !== '' || relative(common(workspace.cwd), common(workspace.original)) !== '') {
    throw new Error('The worker Git worktree was replaced.');
  }
}

function verifyApplied(root, changes) {
  for (const { name, after } of changes) {
    if (!matches(at(root, name), after)) throw new Error('Original result differs at ' + name);
  }
}

function resolveLink(path) {
  try {
    // Preserve filesystem traversal order when a link target contains `..` after another symlink.
    return realpathSync.native(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function expectedAppliedLinks(job, workspace, root, changes) {
  const links = changes.filter(({ after }) => after?.type === 'link');
  if (!links.length) return [];
  const original = realpathSync.native(root);
  const worker = statSync(workspace.cwd, { bigint: true });
  const temporary = statSync(job, { bigint: true });
  return links.map(({ name }) => {
    const source = resolveLink(join(workspace.cwd, name));
    // Compare filesystem identities so spelling aliases on case-insensitive volumes cannot hide job paths.
    for (let ancestor = source; ancestor; ancestor = dirname(ancestor)) {
      const { dev, ino } = statSync(ancestor, { bigint: true });
      if (dev === worker.dev && ino === worker.ino) return [name, resolve(original, relative(ancestor, source))];
      if (dev === temporary.dev && ino === temporary.ino) {
        throw new Error('Result link resolves into the temporary job and would break after cleanup: ' + name);
      }
      if (dirname(ancestor) === ancestor) break;
    }
    return [name, source];
  });
}

function verifyAppliedLinks(root, links) {
  for (const [name, expected] of links) {
    const destination = resolveLink(join(root, name));
    if (destination === null || expected === null ? destination !== expected : relative(destination, expected) !== '') {
      throw new Error('Applied link resolves to a different target: ' + name);
    }
  }
}

function verifySurvivingWindowsLinks(workspace, root, changes, baseline) {
  if (process.platform !== 'win32') return;
  const replacements = changes.filter(({ name, before, after }) => before && after && (before.type !== after.type
    || (before.type === 'link' && windowsLinkType(join(root, name)) !== windowsLinkType(join(workspace.cwd, name)))));
  if (!replacements.length) return;
  const changed = new Set(changes.map(({ name }) => name));
  for (const [name, info] of baseline.entries) {
    if (info.type !== 'link' || changed.has(name)) continue;
    const path = join(workspace.cwd, name);
    const target = resolve(dirname(path), info.target);
    const affected = (root, candidate) => candidate && replacements.some(change => isWithin(join(root, change.name), candidate));
    if (!affected(workspace.cwd, target) && !affected(canonicalPath(workspace.cwd), resolveLink(path))) continue;
    const oldKind = windowsLinkType(join(root, name));
    // Inspect the target independently of the worker link's current Windows kind.
    const nextKind = windowsLinkType(target);
    if (oldKind !== nextKind) {
      throw new Error('Windows link target type changed without a reviewed link change: ' + name);
    }
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

function replaceEntry(root, name, expected, next, source, onWrite = () => {}, savedLinkType) {
  const target = join(root, ...parts(name));
  const check = () => {
    if (!matches(at(root, name), expected)) throw new Error('Original changed during apply: ' + name);
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
    if (!expected) mkdirSync(target);
    if (next.mode !== undefined) chmodSync(target, next.mode);
    onWrite();
  } else {
    const staging = mkdtempSync(join(dirname(target), '.codex-agy-'));
    try {
      const file = join(staging, 'entry');
      const linkType = savedLinkType ?? (next.type === 'link' ? windowsLinkType(source) : undefined);
      copyEntry(source, file, next, linkType);
      if (!equal(entry(file), next)) throw new Error('Result changed during apply: ' + name);
      check();
      if (expected) renameSync(file, target);
      else if (next.type === 'file') linkSync(file, target);
      else symlinkSync(next.target, target, linkType);
      onWrite();
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
}

function applyChanges(job, workspace, review, baseline) {
  const root = verifyOriginal(baseline, { allowNewCommit: true });
  verifySurvivingWindowsLinks(workspace, root, review.changes, baseline);
  if (review.changes.every(({ name, after }) => matches(at(root, name), after))) {
    const links = expectedAppliedLinks(job, workspace, root, review.changes);
    verifyAppliedLinks(root, links);
    return links;
  }
  verifyOriginal(baseline);
  const pending = review.changes.filter(({ name, before, after }) => {
    const current = at(root, name);
    if (matches(current, after)) return false;
    if (!matches(current, before)) throw new Error('Original has conflicting changes at ' + name);
    return true;
  });
  const removing = new Set(pending.filter(({ before, after }) => before && (before.type !== after?.type
    || (process.platform === 'win32' && before.type === 'link')))
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
      if (change.before?.type === 'link') {
        change.linkType = windowsLinkType(join(root, change.name));
      } else if (change.before?.type === 'file') {
        change.backup = join(recovery, String(index));
        copyEntry(join(root, change.name), change.backup, change.before);
        if (!equal(entry(change.backup), change.before)) throw new Error('Original changed during backup: ' + change.name);
      }
    }
    const directoryModes = pending.filter(({ after }) => after?.type === 'directory' && after.mode !== undefined);
    const setDirectoryMode = ({ name, after }, expected) => {
      const current = at(root, name);
      if (current?.type !== 'directory' || (expected && !matches(current, expected))) {
        throw new Error('Original directory changed before applying permissions: ' + name);
      }
      if (current.mode !== after.mode) {
        replace(name, current, after, undefined, () => {
          steps.push({ name, expected: after, next: current });
        });
      }
    };
    const grantsOwnerAccess = ({ before, after }) => before?.type === 'directory' && before.mode !== undefined
      && (after.mode & 0o300) === 0o300 && (before.mode & 0o300) !== 0o300;
    for (const change of directoryModes.filter(grantsOwnerAccess).sort((a, b) => a.name.length - b.name.length)) {
      setDirectoryMode(change, change.before);
    }
    const remove = pending.filter(change => removing.has(change.name)).sort((a, b) => b.name.length - a.name.length);
    const removalModes = new Map();
    for (const { name, before } of [...remove].reverse()) {
      if (process.platform === 'win32' || before.type !== 'directory') continue;
      const current = at(root, name);
      if (!matches(current, before)) throw new Error('Original directory changed before removal: ' + name);
      if ((current.mode & 0o700) === 0o700) {
        removalModes.set(name, current);
        continue;
      }
      const writable = { type: 'directory', mode: current.mode | 0o700 };
      replace(name, current, writable, undefined, () => {
        steps.push({ name, expected: writable, next: current });
      });
      removalModes.set(name, writable);
    }
    for (const { name, before, backup, linkType } of remove) {
      const expected = removalModes.get(name) ?? before;
      replace(name, expected, null);
      steps.push({ name, expected: null, next: expected, source: backup, linkType });
    }
    const write = pending.filter(change => change.after).sort((a, b) => a.name.length - b.name.length);
    for (const { name, before, after, backup, linkType } of write) {
      const expected = removing.has(name) ? null : before;
      if (after.type === 'directory' && expected?.type === 'directory') continue;
      const next = after.type === 'directory' ? { type: 'directory' } : after;
      replace(name, expected, next, join(workspace.cwd, name), () => {
        steps.push({ name, expected: next, next: expected, source: backup, linkType });
      });
    }
    for (const change of directoryModes.filter(change => !grantsOwnerAccess(change)).sort((a, b) => b.name.length - a.name.length)) {
      setDirectoryMode(change, change.before?.type === 'directory' ? change.before : undefined);
    }
    verifyOriginal(baseline);
    verifyApplied(root, review.changes);
    const links = expectedAppliedLinks(job, workspace, root, review.changes);
    verifyAppliedLinks(root, links);
    return links;
  } catch (error) {
    const failures = [];
    for (const step of steps.reverse()) {
      try {
        verifyOriginal(baseline);
        replace(step.name, step.expected, step.next, step.source, undefined, step.linkType);
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
    return applyChanges(job, workspace, review, baseline);
  } finally {
    rmdirSync(lock);
  }
}

function hasGitWorkspace(job, workspace) {
  const nativeJob = canonicalPath(job);
  const entries = registeredWorktrees(workspace.original).filter(path => isWithin(job, path) || isWithin(nativeJob, path));
  const expected = join(nativeJob, relative(job, workspace.cwd));
  if (entries.some(path => relative(expected, path) !== '' && relative(workspace.cwd, path) !== '')) {
    throw new Error('Additional Git worktrees exist under the job.');
  }
  return entries[0];
}

export function removeGitWorkspace(job, workspace) {
  const registered = hasGitWorkspace(job, workspace);
  if (registered) {
    verifyWorkerGit(workspace);
    git(workspace.original, ['worktree', 'remove', '--force', '--', registered]);
  }
  if (lstatSync(workspace.cwd, { throwIfNoEntry: false }) || hasGitWorkspace(job, workspace)) {
    throw new Error('Git worktree cleanup could not be verified.');
  }
}

export function finalizeResult(job, workspace, state, id, decision) {
  const review = readRecord(job, 'review.json');
  if (review.id !== id || review.turn !== state.turn) throw new Error('Review is stale. Review the current results before asking again.');
  if (decision === '--clean' && review.changes.length !== 0) {
    throw new Error('Worker changes remain. Keep them or review them for apply.');
  }
  const recordPath = join(job, 'finalized.json');
  let outcome;
  if (lstatSync(recordPath, { throwIfNoEntry: false })) {
    outcome = readRecord(job, 'finalized.json');
    if (outcome.id !== id || outcome.decision !== decision) throw new Error('Retry finish with the original review and decision.');
  } else {
    verifyReviewedWorkspace(job, workspace, state, review);
    if (decision === '--keep') return { original: review.original, kept: workspace.cwd };
    outcome = { id, decision, original: review.original };
    if (decision === '--apply') {
      verifyNoRecovery(job);
      if (!review.original) throw new Error('This job has no recorded original baseline. Keep the result in its workspace.');
      verifyLinkTargets(job, workspace.cwd, review.original, review.changes.map(({ name, after }) => [name, after]));
      outcome.links = applyResult(job, workspace, review);
    } else verifyCleanup(job, workspace, state);
    writeRecord(job, 'finalized.json', outcome);
  }
  if (decision === '--apply') {
    const baseline = readRecord(job, 'baseline.json');
    const root = verifyOriginal(baseline, { allowNewCommit: true });
    verifyApplied(root, review.changes);
    if (outcome.links === undefined) {
      const hasWorkspace = Boolean(lstatSync(workspace.cwd, { throwIfNoEntry: false }));
      if (!hasWorkspace && review.changes.some(({ after }) => after?.type === 'link')) {
        throw new Error('The link targets from the original apply are unavailable. Inspect the job before cleanup.');
      }
      if (hasWorkspace) verifyReviewedWorkspace(job, workspace, state, review);
      outcome.links = expectedAppliedLinks(job, workspace, root, review.changes);
      verifyAppliedLinks(root, outcome.links);
      writeRecord(job, 'finalized.json', outcome);
    } else {
      verifyAppliedLinks(root, outcome.links);
    }
  }
  verifyCleanup(job, workspace, state);
  const hasWorkspace = Boolean(lstatSync(workspace.cwd, { throwIfNoEntry: false }));
  if (hasWorkspace) verifyReviewedWorkspace(job, workspace, state, review);
  if (state.kind === 'git') removeGitWorkspace(job, workspace);
  else {
    const cleanupWork = join(dirname(workspace.cwd), 'cleanup-work');
    if (hasWorkspace) renameSync(workspace.cwd, cleanupWork);
    if (lstatSync(cleanupWork, { throwIfNoEntry: false })) {
      if (!managedWorkspace(cleanupWork, job, { cleaning: true })) throw new Error('Invalid cleanup workspace.');
      if (!hasWorkspace) verifyRemainingCopy(job, cleanupWork, review);
      removeFileWorkspace(cleanupWork);
    }
  }
  return { original: review.original, cleanupEntries: verifyCleanup(job, workspace, state, { workspaceRemoved: true }) };
}

function verifyRemainingCopy(job, cleanupWork, review) {
  const baseline = lstatSync(join(job, 'baseline.json'), { throwIfNoEntry: false })
    ? readRecord(job, 'baseline.json') : null;
  const approved = new Map(baseline?.entries ?? []);
  for (const { name, after } of review.changes) approved.set(name, after);
  for (const [name, current] of snapshot(cleanupWork, false, review.directoryModes === true)) {
    const expected = approved.get(name);
    if (matches(current, expected)) continue;
    // Partial removal can grant the owner access to existing directories before deleting files.
    if (current.type === 'directory' && expected?.type === 'directory' && expected.mode !== undefined
      && current.mode === (expected.mode | 0o700)) continue;
    throw new Error('Unreviewed file remains in cleanup workspace: ' + name);
  }
}

export function verifyNoRecovery(job) {
  if (readdirSync(job).some(name => name.startsWith('apply-backup-'))) {
    throw new Error('An apply recovery backup remains. Inspect it before removing the job.');
  }
}

function verifyCleanup(job, workspace, state, { workspaceRemoved = false } = {}) {
  verifyNoRecovery(job);
  const entries = readdirSync(job, { withFileTypes: true });
  for (const info of entries) {
    const { name } = info;
    if (info.isFile() && (['baseline.json', 'finalized.json', 'operation.lock', 'review.json', 'status.json'].includes(name)
      || /^prompt(?:[-_][a-z0-9_-]+)?\.(?:txt|md)$/i.test(name))) continue;
    if (info.isDirectory() && ['gemini', 'workspaces'].includes(name)) continue;
    if (info.isDirectory() && /^turn-[a-z0-9]{6}$/i.test(name)
      && readdirSync(join(job, name), { withFileTypes: true }).every(file => file.isFile()
        && ['agy.log', 'stderr.log', 'response.txt', 'events.jsonl', 'cancel'].includes(file.name))) continue;
    throw new Error('Unreviewed job entry remains: ' + name);
  }

  const storage = join(job, 'workspaces');
  const directory = dirname(workspace.cwd);
  const children = path => {
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (!info) return [];
    if (!info.isDirectory()) throw new Error('Invalid workspace storage: ' + path);
    return readdirSync(path, { withFileTypes: true });
  };
  const disposableCopy = !workspaceRemoved && state.kind !== 'git' && entries.some(info => info.name === 'finalized.json')
    && !lstatSync(workspace.cwd, { throwIfNoEntry: false });
  const allowed = info => info.isFile() ? ['workspace.json', 'operation.lock'].includes(info.name)
    : info.isDirectory() && ((!workspaceRemoved && info.name === 'work') || (disposableCopy && info.name === 'cleanup-work'));
  if (children(storage).some(info => !info.isDirectory() || info.name !== basename(directory))
    || children(directory).some(info => !allowed(info))) {
    throw new Error('Additional workspace entries exist under the job.');
  }
  if (state.kind === 'git' && lstatSync(workspace.cwd, { throwIfNoEntry: false })) {
    const baseline = readRecord(job, 'baseline.json');
    const current = gitState(workspace.cwd);
    if (current.head !== baseline.originalGit?.head || current.branch !== 'HEAD'
      || git(workspace.cwd, ['diff', '--cached', '--name-only', '-z'])) {
      throw new Error('Worker Git HEAD or staged changes require inspection before cleanup.');
    }
  }
  return entries;
}

function verifyReviewedWorkspace(job, workspace, state, review) {
  if (state.kind === 'git') {
    if (!hasGitWorkspace(job, workspace)) throw new Error('The worker Git worktree is no longer registered.');
    verifyWorkerGit(workspace);
  }
  if (keyFor(snapshot(workspace.cwd, state.kind === 'git', review.directoryModes === true)) !== review.result) {
    throw new Error('Worker files changed after review. Review them and ask again.');
  }
}
