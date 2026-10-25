import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, opendirSync, lstatSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export class ChangeWatchError extends Error {}
export const MAX_REVIEW_REQUESTS = 5;
const errorCodes = new Set(['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'ENOSPC', 'EMFILE', 'ENFILE', 'ENOMEM',
  'EIO', 'EROFS', 'ENOSYS', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'EEXIST',
  'EAGAIN', 'ENOBUFS', 'EBADF', 'EINVAL', 'ENAMETOOLONG', 'ENOTEMPTY']);
export function watchErrorCode(error) {
  const code = error?.code ?? error?.cause?.code;
  return errorCodes.has(code) ? code : undefined;
}
const digest = (value) => createHash('sha256').update(value).digest('hex');
const terminalActions = new Set(['unchanged', 'review-finished', 'review-limit', 'watch-failed', 'superseded']);
function isTerminal(state) {
  if (state.version !== 2 || state.phase !== 'closed' || !terminalActions.has(state.action)) return false;
  if (state.action === 'watch-failed') return typeof state.failed === 'string' && !!state.failed;
  if (typeof state.changed !== 'boolean' || typeof state.reviewing !== 'boolean'
      || !Number.isSafeInteger(state.reviewRequests) || state.reviewRequests < 0 || state.reviewRequests > MAX_REVIEW_REQUESTS) return false;
  if (state.action === 'unchanged') return !state.changed && !state.reviewing && state.reviewRequests === 0;
  if (state.action === 'review-limit') return state.changed && state.reviewing && state.reviewRequests === MAX_REVIEW_REQUESTS;
  if (state.action === 'review-finished') return state.changed && state.reviewing && state.reviewRequests > 0;
  return true;
}
const terminalResult = (state) => ({ terminal: state.action, failed: !!state.failed,
  ...(state.action === 'unchanged' && !state.failed ? { changed: false } : {}) });

export function saveWatch(path, state) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    renameSync(temp, path);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* Preserve the write failure; stale temporary files are cleaned later. */ }
    throw error;
  }
}

function identity(client, session, turn, paths) {
  if (typeof session !== 'string' || !session || typeof turn !== 'string' || !turn
      || !Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== 'string' || !isAbsolute(p))) {
    throw new ChangeWatchError('Missing change tracking identity');
  }
  const directory = join(tmpdir(), 'ai-setting-code-quality-review');
  const owner = digest(JSON.stringify([client, session, paths.map((p) => resolve(p))]));
  return { directory, owner, path: join(directory, `${digest(JSON.stringify([owner, turn]))}.json`) };
}

export function requestWatch(state, command, action) {
  return new Promise((resolveRequest, reject) => {
    const socket = connect(state.endpoint);
    let response = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolveRequest(value);
    };
    const fail = (error) => finish(new ChangeWatchError('Watcher unavailable', { cause: error }));
    const timer = setTimeout(fail, 3500);
    socket.on('error', fail);
    socket.on('close', () => { if (!settled) fail(); });
    socket.on('connect', () => socket.write(`${JSON.stringify({ token: state.token, command, action })}\n`));
    socket.on('data', (chunk) => { response += chunk; if (response.length > 4096) fail(); });
    socket.on('end', () => {
      try {
        const result = JSON.parse(response);
        if (!['starting', 'ready', 'closed', 'failed'].includes(result.phase)
            || typeof result.failed !== 'boolean' || typeof result.changed !== 'boolean'
            || typeof result.reviewing !== 'boolean' || !Number.isSafeInteger(result.reviewRequests)
            || result.reviewRequests < 0 || result.reviewRequests > MAX_REVIEW_REQUESTS
            || typeof result.action !== 'string' || result.failed) throw new ChangeWatchError('Change tracking failed');
        finish(null, result);
      } catch { finish(new ChangeWatchError('Invalid watcher response')); }
    });
  });
}

export async function finishWatch(state) {
  if (state.version === 2 && state.endpoint && !isTerminal(state)) {
    try { await requestWatch(state, 'finish', 'superseded'); } catch { /* Failed state is retained for reporting. */ }
  }
}

export async function stopSession(client, session, paths) {
  const key = identity(client, session, 'cleanup', paths);
  const ownerPath = join(key.directory, `owner-${key.owner}.json`);
  if (!existsSync(ownerPath)) return;
  const old = JSON.parse(readFileSync(ownerPath, 'utf8'));
  if (!/^[a-f0-9]{64}\.json$/.test(old.file)) throw new ChangeWatchError('Invalid watcher owner');
  const path = join(key.directory, old.file);
  try {
    const previous = JSON.parse(readFileSync(path, 'utf8'));
    await finishWatch(previous);
    if (previous.failed && !previous.endpoint && old.watch) {
      await finishWatch(old.watch);
      saveWatch(path, previous);
    }
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; if (old.watch) await finishWatch(old.watch); }
}

export async function stopChanges(client, session, turn, paths) {
  const { path, directory, owner } = identity(client, session, turn, paths);
  let state;
  try { state = JSON.parse(readFileSync(path, 'utf8')); }
  catch { state = { version: 2 }; }
  if (isTerminal(state) && state.action !== 'watch-failed') return;
  let watch = state;
  if (!watch.endpoint) {
    try {
      const old = JSON.parse(readFileSync(join(directory, `owner-${owner}.json`), 'utf8'));
      if (old.file === path.split(/[\\/]/).at(-1) && old.watch) watch = old.watch;
    } catch { /* The missing cleanup reference remains a tracking failure below. */ }
  }
  await finishWatch({ version: 2, endpoint: watch.endpoint, token: watch.token });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  saveWatch(path, { ...state, version: 2, owner, phase: 'closed', failed: state.failed || 'watch-unavailable', action: 'watch-failed', updatedAt: Date.now() });
}

async function ready(path) {
  const deadline = Date.now() + 4500;
  while (Date.now() < deadline) {
    let state;
    state = JSON.parse(readFileSync(path, 'utf8'));
    if (state.version !== 2 || state.failed || state.phase === 'closed') throw new ChangeWatchError('Change tracking unavailable');
    try {
      const status = await requestWatch(state, 'status');
      if (status.phase === 'ready') return state;
    } catch (error) {
      if (state.phase === 'ready') throw error;
    }
    await delay(25);
  }
  throw new ChangeWatchError('Watcher startup timed out');
}

function cleanupStates(directory, currentFile, currentOwner) {
  const marker = join(directory, 'cleanup-completed.json');
  const startedAt = Date.now();
  try {
    const last = JSON.parse(readFileSync(marker, 'utf8'));
    if (last?.version === 1 && Number.isSafeInteger(last.completedAt)
        && last.completedAt <= startedAt && startedAt - last.completedAt < 60 * 60 * 1000) return;
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const protectedFiles = new Set([currentFile, currentOwner]);
  const stateName = /^[a-f0-9]{64}\.json$/;
  const ownerName = /^owner-[a-f0-9]{64}\.json$/;
  const temporaryName = /^((?:(?:owner-)?[a-f0-9]{64}|cleanup-completed)\.json)\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/;
  function read(name) {
    try {
      const value = JSON.parse(readFileSync(join(directory, name), 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch (error) { if (error.code === 'ENOENT') return undefined; if (error instanceof SyntaxError) return null; throw error; }
  }
  function old(name) {
    try { const stat = lstatSync(join(directory, name)); return stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < cutoff; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  const current = read(currentOwner);
  if (stateName.test(current?.file)) protectedFiles.add(current.file);
  function removeState(name, expectedOwner) {
    if (protectedFiles.has(name) || !old(name)) return;
    const state = read(name);
    if (!state || !isTerminal(state) || !/^[a-f0-9]{64}$/.test(state.owner)) return;
    const ownerFile = `owner-${state.owner}.json`;
    if (expectedOwner && ownerFile !== expectedOwner) return;
    const owner = read(ownerFile);
    if (owner === null || (owner?.file === name && (protectedFiles.has(ownerFile) || !old(ownerFile)))) return;
    unlinkSync(join(directory, name));
    if (owner?.file === name && !protectedFiles.has(ownerFile) && old(ownerFile) && read(ownerFile)?.file === name) {
      unlinkSync(join(directory, ownerFile));
    }
  }
  const entries = opendirSync(directory);
  try {
    for (let count = 0, entry; count < 5000 && (entry = entries.readSync()); count++) {
      const name = entry.name;
      if (!(stateName.test(name) || ownerName.test(name) || temporaryName.test(name)) || protectedFiles.has(name) || !old(name)) continue;
      try {
        if (stateName.test(name)) removeState(name);
        else if (ownerName.test(name)) {
          const owner = read(name);
          if (stateName.test(owner?.file)) removeState(owner.file, name);
        } else {
          const match = name.match(temporaryName);
          if (!match || protectedFiles.has(match[1])) continue;
          if (match[1] === 'cleanup-completed.json') { unlinkSync(join(directory, name)); continue; }
          let target = read(match[1]);
          if (ownerName.test(match[1]) && stateName.test(target?.file)) target = read(target.file) ?? null;
          if (target === undefined || (target && isTerminal(target))) unlinkSync(join(directory, name));
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  } finally { entries.closeSync(); }
  saveWatch(marker, { version: 1, completedAt: Date.now() });
}

export function readGitMetadata(cwd, args, maxBuffer, signal) {
  return new Promise((resolveOutput, reject) => {
    let outputBytes = 0, overflow = false;
    const child = execFile('git', ['-C', cwd, ...args], {
      encoding: 'buffer', windowsHide: true, timeout: 1000, killSignal: 'SIGKILL', maxBuffer, signal,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    }, async (error, stdout) => {
      await closed;
      if (error || overflow) {
        const code = overflow || error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'ENOBUFS'
          : error?.killed ? 'ETIMEDOUT' : error?.code;
        reject(Object.assign(new Error('Git metadata lookup failed'), { code, signal: error?.signal }));
        return;
      }
      resolveOutput(stdout);
    });
    const closed = new Promise(resolveClosed => child.once('close', resolveClosed));
    // spawnSync limits the combined raw output; execFile limits each stream separately.
    const countOutput = chunk => {
      outputBytes += chunk.length;
      if (!overflow && outputBytes > maxBuffer) {
        overflow = true;
        if (!child.killed) child.kill('SIGKILL');
      }
    };
    child.stdout.on('data', countOutput); child.stderr.on('data', countOutput);
  });
}

async function discoverRoots(paths) {
  const roots = [];
  for (let index = 0; index < paths.length; index += 2) {
    const batch = await Promise.allSettled(paths.slice(index, index + 2).map(async cwd => {
      try {
        const stdout = await readGitMetadata(cwd, ['rev-parse', '--show-toplevel'], 1024 * 1024);
        return { path: stdout.toString('utf8').trim(), git: true };
      } catch (error) {
        const processExit = typeof error.code === 'number' || (error.code === null && typeof error.signal === 'string');
        if (error.code !== 'ENOENT' && !processExit) throw error;
        return { path: resolve(cwd), git: false };
      }
    }));
    for (const result of batch) {
      if (result.status === 'rejected') throw result.reason;
      roots.push(result.value);
    }
  }
  return roots;
}

async function startChanges(client, session, turn, paths, canStart) {
  const key = identity(client, session, turn, paths);
  mkdirSync(key.directory, { recursive: true, mode: 0o700 });
  if (existsSync(key.path)) {
    if (isTerminal(JSON.parse(readFileSync(key.path, 'utf8')))) return;
    await ready(key.path); return;
  }
  const ownerPath = join(key.directory, `owner-${key.owner}.json`);
  if (existsSync(ownerPath)) {
    const old = JSON.parse(readFileSync(ownerPath, 'utf8'));
    if (old.file === key.path.split(/[\\/]/).at(-1)) {
      if (old.watch) await finishWatch(old.watch);
      throw new ChangeWatchError('Prepared watcher state was lost');
    }
  }
  if (!canStart) throw new ChangeWatchError('Cannot prepare after the request has started');
  await stopSession(client, session, paths);
  cleanupStates(key.directory, key.path.split(/[\\/]/).at(-1), `owner-${key.owner}.json`);
  const roots = await discoverRoots(paths);
  const id = randomUUID();
  const state = { version: 2, owner: key.owner, phase: 'starting', token: randomUUID(),
    endpoint: process.platform === 'win32' ? `\\\\.\\pipe\\ai-setting-quality-${id}` : join(key.directory, `${id.slice(0, 8)}.sock`),
    roots: [...new Map(roots.map((root) => [root.path, root])).values()],
    changed: false, reviewing: false, reviewRequests: 0, stops: 0, action: 'preparing', updatedAt: Date.now() };
  try { writeFileSync(key.path, JSON.stringify(state), { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') { await ready(key.path); return; } throw error; }
  saveWatch(ownerPath, { file: key.path.split(/[\\/]/).at(-1), watch: { version: 2, endpoint: state.endpoint, token: state.token } });
  const worker = fileURLToPath(new URL('./watch-worker.mjs', import.meta.url));
  if (process.platform === 'win32') {
    // ShellExecute keeps the watcher from inheriting the hook's PowerShell output pipes.
    const quote = (value) => `'${value.replaceAll('\\', '/').replace(/['\u2018-\u201b]/g, (char) => char + char)}'`;
    const command = `$ErrorActionPreference = 'Stop'; Start-Process -FilePath ${quote(process.execPath)} -ArgumentList ${quote(`"${worker.replaceAll('\\', '/')}" "${key.path.replaceAll('\\', '/')}"`)} -WindowStyle Hidden`;
    const launched = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
      stdio: 'ignore', windowsHide: true, timeout: 3000,
    });
    if (launched.status !== 0) throw launched.error ?? new ChangeWatchError('Watcher launch failed');
  } else {
    const child = spawn(process.execPath, [worker, key.path], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  }
  await ready(key.path);
}

export async function prepareChanges(client, session, turn, paths, canStart = true) {
  const key = identity(client, session, turn, paths);
  try { await startChanges(client, session, turn, paths, canStart); }
  catch (error) {
    try {
      mkdirSync(key.directory, { recursive: true, mode: 0o700 });
      let state = existsSync(key.path) ? JSON.parse(readFileSync(key.path, 'utf8')) : { version: 2 };
      await finishWatch(state);
      if (existsSync(key.path)) state = JSON.parse(readFileSync(key.path, 'utf8'));
      saveWatch(key.path, { ...state, owner: key.owner, phase: 'closed', failed: state.failed || 'watch-prepare-failed',
        errorCode: state.errorCode ?? watchErrorCode(error), action: 'watch-failed', updatedAt: Date.now() });
    } catch { /* Missing or invalid state also fails the Stop check. */ }
    throw new ChangeWatchError('Change tracking preparation failed');
  }
}

export async function checkChanges(client, session, turn, paths) {
  const { path } = identity(client, session, turn, paths);
  let state;
  try { state = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new ChangeWatchError('Missing watcher state'); }
  if (isTerminal(state)) return terminalResult(state);
  if (state.version !== 2 || state.phase !== 'ready' || state.failed) throw new ChangeWatchError('Change tracking unavailable');
  let status;
  try { status = await requestWatch(state, 'check'); }
  catch (error) {
    const latest = JSON.parse(readFileSync(path, 'utf8'));
    if (isTerminal(latest)) return terminalResult(latest);
    throw error;
  }
  if (isTerminal({ ...status, version: 2 })) return terminalResult(status);
  if (status.phase !== 'ready') throw new ChangeWatchError('Watcher stopped');
  return { changed: status.changed, reviewing: status.reviewing, record: async (action) => {
    return requestWatch(state, action === 'review-finished' ? 'finish' : 'record', action);
  } };
}
