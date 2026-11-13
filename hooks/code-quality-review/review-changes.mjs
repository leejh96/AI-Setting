import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, opendirSync, lstatSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
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

export function requestWatch(state, command, action, timeout = 3500) {
  return new Promise((resolveRequest, reject) => {
    const socket = connect(state.endpoint);
    let response = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolveRequest(value);
    };
    const fail = (error) => finish(new ChangeWatchError('Watcher unavailable', { cause: error }));
    const timer = setTimeout(() => fail({ code: 'ETIMEDOUT' }), timeout);
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

export async function stopSession(client, session, paths, exceptFile) {
  const key = identity(client, session, 'cleanup', paths);
  const ownerPath = join(key.directory, `owner-${key.owner}.json`);
  if (!existsSync(ownerPath)) return;
  const old = JSON.parse(readFileSync(ownerPath, 'utf8'));
  await stopPrevious(key.directory, old, exceptFile);
}

async function stopPrevious(directory, old, exceptFile) {
  if (!/^[a-f0-9]{64}\.json$/.test(old.file)) throw new ChangeWatchError('Invalid watcher owner');
  if (old.file === exceptFile) return;
  const path = join(directory, old.file);
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

async function ready(path, deadline = Date.now() + 9000) {
  let starting = false;
  while (Date.now() < deadline) {
    let state;
    state = JSON.parse(readFileSync(path, 'utf8'));
    if (isTerminal(state) && !state.failed && state.action !== 'superseded') return state;
    if (state.version !== 2 || state.failed || state.phase === 'closed') throw new ChangeWatchError('Change tracking unavailable');
    if (state.phase === 'preparing') { await delay(25); continue; }
    if (!starting) { starting = true; deadline = Math.min(deadline, Date.now() + 4500); }
    try {
      const status = await requestWatch(state, 'status', undefined, Math.min(3500, Math.max(1, deadline - Date.now())));
      if (status.phase === 'ready') return state;
    } catch (error) {
      if (state.phase === 'ready') throw error;
    }
    await delay(25);
  }
  throw new ChangeWatchError('Watcher startup timed out', { cause: { code: 'ETIMEDOUT' } });
}

// Serialize only owner registration, never Git lookups or worker RPCs. Unique
// markers let a later process recover a crashed holder without deleting a new lock.
async function ownerLock(directory, owner) {
  const path = join(directory, `owner-${owner}.lock`);
  const marker = `${process.pid}-${randomUUID()}.lock`, own = join(path, marker);
  const remove = target => { try { unlinkSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
  const empty = () => { try { rmdirSync(path); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; } };
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    try {
      mkdirSync(path, { mode: 0o700 });
      try {
        writeFileSync(own, '', { flag: 'wx', mode: 0o600 });
        if (readdirSync(path).every(name => name === marker)) return () => { remove(own); empty(); };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      remove(own);
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    let names;
    try { names = readdirSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
    for (const name of names) {
      const match = /^(\d+)-[a-f0-9-]{36}\.lock$/.exec(name);
      if (!match) continue;
      try { process.kill(Number(match[1]), 0); }
      catch (error) { if (error.code === 'ESRCH') remove(join(path, name)); else if (error.code !== 'EPERM') throw error; }
    }
    empty();
    await delay(10);
  }
  throw new ChangeWatchError('Watcher owner registration timed out', { cause: { code: 'ETIMEDOUT' } });
}

export function ownsWatch(path, state) {
  const ownerPath = join(dirname(path), `owner-${state.owner}.json`);
  try {
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
    return owner.file === path.split(/[\\/]/).at(-1) && owner.watch?.token === state.token;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

const canonicalPath = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
export function verifyAliases(aliases = []) {
  for (const alias of aliases) {
    if (canonicalPath(realpathSync(alias.path)) !== canonicalPath(alias.target)) throw new ChangeWatchError('Workspace link target changed');
  }
}

function cleanupStates(directory, currentFile, currentOwner, previousFile) {
  const marker = join(directory, 'cleanup-completed.json');
  const startedAt = Date.now();
  try {
    const last = JSON.parse(readFileSync(marker, 'utf8'));
    if (last?.version === 1 && Number.isSafeInteger(last.completedAt)
        && last.completedAt <= startedAt && startedAt - last.completedAt < 60 * 60 * 1000) return;
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const protectedFiles = new Set([currentFile, currentOwner, previousFile]);
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
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    }, async (error, stdout, stderr) => {
      await closed;
      if (error || overflow) {
        const code = overflow || error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'ENOBUFS'
          : error?.killed ? 'ETIMEDOUT' : error?.code;
        const notRepository = code === 128
          && /^fatal: not a git repository \(or any /m.test(stderr?.toString('utf8') ?? '');
        reject(Object.assign(new Error('Git metadata lookup failed'), { code, signal: error?.signal, notRepository }));
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
        if (error.code !== 'ENOENT' && !error.notRepository) throw error;
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
  const file = key.path.split(/[\\/]/).at(-1);
  let old, state, reused = false, lost = false;
  const release = await ownerLock(key.directory, key.owner);
  try {
    if (existsSync(key.path)) reused = true;
    else {
      if (existsSync(ownerPath)) old = JSON.parse(readFileSync(ownerPath, 'utf8'));
      if (old && !/^[a-f0-9]{64}\.json$/.test(old.file)) throw new ChangeWatchError('Invalid watcher owner');
      lost = old?.file === file;
      if (!lost) {
        if (!canStart) throw new ChangeWatchError('Cannot prepare after the request has started');
        const id = randomUUID();
        state = { version: 2, owner: key.owner, phase: 'preparing', token: randomUUID(),
          endpoint: process.platform === 'win32' ? `\\\\.\\pipe\\ai-setting-quality-${id}` : join(key.directory, `${id.slice(0, 8)}.sock`),
          roots: [], changed: false, reviewing: false, reviewRequests: 0, stops: 0, action: 'preparing', updatedAt: Date.now() };
        saveWatch(key.path, state);
        saveWatch(ownerPath, { file, watch: { version: 2, endpoint: state.endpoint, token: state.token } });
      }
    }
  } finally { release(); }
  if (reused) {
    if (!isTerminal(JSON.parse(readFileSync(key.path, 'utf8')))) await ready(key.path);
    return;
  }
  if (lost) {
    if (old.watch) await finishWatch(old.watch);
    throw new ChangeWatchError('Prepared watcher state was lost');
  }
  if (old) await stopPrevious(key.directory, old, file);
  cleanupStates(key.directory, file, `owner-${key.owner}.json`, old?.file);
  const aliases = paths.map(path => ({ path: resolve(path), target: realpathSync(path) }))
    .filter(alias => canonicalPath(alias.path) !== canonicalPath(alias.target));
  const roots = await discoverRoots(paths);
  if (!ownsWatch(key.path, state)) throw new ChangeWatchError('Preparation superseded');
  state.roots = [...new Map(roots.map(root => [root.path, root])).values()];
  state.aliases = aliases; state.phase = 'starting';
  saveWatch(key.path, state);
  const worker = fileURLToPath(new URL('./watch-worker.mjs', import.meta.url));
  if (process.platform === 'win32') {
    const deadline = Date.now() + 7500;
    // ShellExecute keeps the watcher from inheriting the hook's PowerShell output pipes.
    const quote = (value) => `'${value.replaceAll('\\', '/').replace(/['\u2018-\u201b]/g, (char) => char + char)}'`;
    const command = `$ErrorActionPreference = 'Stop'; Start-Process -FilePath ${quote(process.execPath)} -ArgumentList ${quote(`"${worker.replaceAll('\\', '/')}" "${key.path.replaceAll('\\', '/')}"`)} -WindowStyle Hidden`;
    const launched = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
      stdio: 'ignore', windowsHide: true, timeout: 6000,
    });
    if (launched.status !== 0) throw launched.error ?? new ChangeWatchError('Watcher launch failed');
    await ready(key.path, deadline);
    return;
  }
  const child = spawn(process.execPath, [worker, key.path], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
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
