import { randomUUID } from 'node:crypto';
import { watch, lstatSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { saveWatch, watchErrorCode, readGitMetadata, ownsWatch, verifyAliases, MAX_REVIEW_REQUESTS } from './review-changes.mjs';

const path = process.argv[2];
const state = JSON.parse(readFileSync(path, 'utf8'));
if (state.version !== 2 || state.phase !== 'starting' || state.failed) process.exit(1);
const excluded = new Set(['.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', '__pycache__', '.cache', '.next', 'dist', 'build', 'coverage', 'target']);
const probePattern = /^\.ai-setting-quality-probe-[a-f0-9-]{36}\.tmp$/;
let closing = false;
let generation = 0;
const roots = [];
const startup = new AbortController();
const persist = () => { state.updatedAt = Date.now(); saveWatch(path, state); };
const markEdited = () => {
  state.changed = true; state.action = 'edited'; persist();
  for (const root of roots) {
    root.tracked.clear();
    root.ignoreChild?.kill('SIGKILL');
  }
};
const view = () => ({ phase: state.phase, failed: !!state.failed, changed: state.changed, reviewing: state.reviewing,
  reviewRequests: state.reviewRequests ?? 0, action: state.action });
function fail(reason, error) {
  if (closing || state.failed) return;
  state.failed = reason;
  state.errorCode = watchErrorCode(error);
  finish('watch-failed');
}
function eligible(root, filename, eventType) {
  if (typeof filename !== 'string' || !filename) throw Error('Missing event filename');
  let full, rel, parts;
  const nativeParts = filename.split(sep === '\\' ? /[\\/]/ : sep);
  // Windows drive-relative paths such as C:foo are not absolute.
  if (!isAbsolute(filename) && !(sep === '\\' && /^[a-z]:/i.test(filename))
      && nativeParts.every(part => part && part !== '.' && part !== '..')) {
    parts = nativeParts; rel = parts.join(sep);
  } else {
    full = resolve(root.path, filename); rel = relative(root.path, full); parts = rel.split(sep);
  }
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error('Invalid event path');
  if (parts.some((part) => excluded.has(part) || probePattern.test(part))
      || /\.(md|rst|adoc)$/i.test(rel)
      || /^(readme|changelog|license|licence|notice|authors|contributing)(\..*)?$/i.test(parts.at(-1))) return null;
  full ??= resolve(root.path, rel);
  const stateRel = relative(dirname(path), full);
  if (!stateRel.startsWith(`..${sep}`) && stateRel !== '..' && !isAbsolute(stateRel)) return null;
  let current = root.path, fullStat;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      if (current === full) fullStat = stat;
      if (stat.isSymbolicLink()) return current === full ? rel.replaceAll(sep, '/') : null;
    }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') break; throw error; }
  }
  try { if (eventType === 'change' && (fullStat ?? lstatSync(full)).isDirectory()) return null; }
  catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
  return rel.replaceAll(sep, '/');
}
function ignored(root, names) {
  return new Promise((resolveIgnored, reject) => {
    const child = spawn('git', ['-C', root.path, 'check-ignore', '--stdin', '-z'], {
      windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    root.ignoreChild = child;
    child.stdout.setEncoding('utf8');
    let stdout = ''; const timer = setTimeout(() => { child.kill(); reject(Error('Ignore check timeout')); }, 1000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', (data) => { stdout += data; if (stdout.length > 1024 * 1024) { child.kill(); reject(Error('Ignore output limit')); } });
    child.stderr.resume(); child.stdin.on('error', reject);
    child.on('close', (code) => {
      if (root.ignoreChild === child) root.ignoreChild = undefined;
      clearTimeout(timer);
      if (![0, 1].includes(code)) reject(Error('Ignore check failed'));
      else resolveIgnored(new Set(stdout.split('\0').filter(Boolean)));
    });
    child.stdin.end(names.join('\0') + '\0');
  });
}
function flush(root) {
  if (root.flushing) return root.flushing;
  if (closing || !root.pending.size || state.changed || state.failed) { root.pending.clear(); return Promise.resolve(); }
  root.flushing = (async () => {
    const deadline = Date.now() + 2000;
    try {
      while (root.pending.size && !state.changed && !state.failed) {
        if (Date.now() > deadline) throw Error('Event drain timeout');
        const requested = root.pending; root.pending = new Set();
        const names = [...requested];
        if (state.phase === 'starting' && names.some(name => root.tracked.has(name))) { markEdited(); break; }
        let skip;
        try { skip = root.git ? await ignored(root, names) : new Set(); }
        catch (error) { if (closing || state.changed || state.failed) return; throw error; }
        if (closing || state.changed || state.failed) return;
        for (const name of skip) if (!requested.has(name)) throw Error('Invalid ignore output');
        if (skip.size < requested.size) markEdited();
      }
      if (state.changed || state.failed) root.pending.clear();
    } catch (error) { fail('event-filter-failed', error); }
  })().finally(() => { root.flushing = null; });
  return root.flushing;
}
async function probe(root) {
  const name = `.ai-setting-quality-probe-${randomUUID()}.tmp`, target = join(root.path, name);
  let timer;
  try {
    await new Promise((resolveProbe, reject) => {
      root.probes.set(name, resolveProbe);
      timer = setTimeout(() => reject(Error('Probe timeout')), 1500);
      writeFileSync(target, '', { flag: 'wx', mode: 0o600 });
    });
    const stat = lstatSync(root.path);
    if (!stat.isDirectory() || stat.dev !== root.dev || stat.ino !== root.ino) throw Error('Watch root replaced');
  } finally {
    clearTimeout(timer); root.probes.delete(name);
    try { unlinkSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
async function checkpoint() {
  const deadline = Date.now() + 2500;
  await Promise.all(roots.map(probe));
  let seen;
  do {
    if (Date.now() > deadline) throw Error('Checkpoint timeout');
    if (state.changed) break;
    seen = generation;
    await delay(20);
    await Promise.all(roots.map(flush));
  } while (seen !== generation || roots.some((root) => root.pending.size || root.flushing));
  if (state.failed) throw Error('Watcher failed');
  verifyAliases(state.aliases);
  if (!ownsWatch(path, state)) throw Error('Watcher superseded');
}
function finish(action) {
  if (closing) return;
  closing = true; state.phase = 'closed'; state.action = action;
  startup.abort();
  try { persist(); } catch (error) {
    state.failed ||= 'watch-state-write-failed'; state.errorCode ??= watchErrorCode(error);
    state.action = 'watch-failed';
    try { persist(); } catch { /* The failed RPC response still prevents a successful completion. */ }
  }
  for (const root of roots) {
    root.ignoreChild?.kill('SIGKILL');
    root.watcher?.close();
  }
  server.close(); clearTimeout(expiry);
  setTimeout(() => process.exit(), 100).unref();
}
let queue = Promise.resolve();
const server = createServer({ allowHalfOpen: true }, (socket) => {
  let input = '', handled = false; socket.setTimeout(4000, () => socket.destroy());
  socket.on('error', () => {});
  socket.on('data', (data) => {
    input += data;
    if (input.length > 4096) { socket.destroy(); return; }
    if (!input.includes('\n') || handled) return;
    handled = true;
    queue = queue.then(async () => {
      let request;
      try { request = JSON.parse(input); if (request.token !== state.token) { socket.end('{}\n'); return; }
        if (request.command === 'finish') { finish(request.action); socket.end(`${JSON.stringify(view())}\n`); return; }
        if (!ownsWatch(path, state)) { finish('superseded'); socket.end(`${JSON.stringify(view())}\n`); return; }
        if (request.command === 'check') {
          if (state.phase === 'closed') { socket.end(`${JSON.stringify(view())}\n`); return; }
          if (state.phase !== 'ready') throw Error('Not ready');
          await checkpoint(); state.stops++;
          if (!state.changed) { finish('unchanged'); socket.end(`${JSON.stringify(view())}\n`); return; }
          state.action = 'review-required'; persist();
        } else if (request.command === 'record') {
          if (state.phase === 'closed') { socket.end(`${JSON.stringify(view())}\n`); return; }
          if (request.action !== 'review-requested' || state.phase !== 'ready'
              || !Number.isSafeInteger(state.reviewRequests) || state.reviewRequests < 0) throw Error('Invalid action');
          if (state.reviewRequests >= MAX_REVIEW_REQUESTS) { finish('review-limit'); socket.end(`${JSON.stringify(view())}\n`); return; }
          state.reviewRequests++;
          state.reviewing = true; state.action = request.action; persist();
        } else if (request.command !== 'status') throw Error('Invalid request');
        socket.end(`${JSON.stringify(view())}\n`);
      } catch (error) { fail('watch-check-failed', error); socket.end(`${JSON.stringify(view())}\n`); }
    }).catch((error) => { socket.destroy(); fail('watch-state-failed', error); });
  });
});
const expiry = setTimeout(() => { fail('watch-lifetime-expired'); finish('watch-failed'); }, 24 * 60 * 60 * 1000);
process.on('uncaughtException', (error) => { try { fail('worker-exception', error); } finally { process.exitCode = 1; } });
process.on('unhandledRejection', (error) => fail('worker-rejection', error));
server.on('error', (error) => { fail('watch-server-failed', error); process.exitCode = 1; });
server.listen(state.endpoint, async () => {
  try {
    if (!ownsWatch(path, state)) { finish('superseded'); return; }
    verifyAliases(state.aliases);
    state.pid = process.pid;
    for (const info of state.roots) {
      const stat = lstatSync(info.path);
      if (!stat.isDirectory()) throw Error('Invalid watch root');
      const root = { ...info, dev: stat.dev, ino: stat.ino, pending: new Set(), probes: new Map(), tracked: new Set() };
      roots.push(root);
      root.watcher = watch(root.path, { recursive: true }, (eventType, filename) => {
        try {
          if (closing || state.failed) return;
          if (root.probes.has(filename)) { root.probes.get(filename)(); return; }
          if (state.changed) return;
          const rel = eligible(root, filename, eventType);
          if (rel) {
            if (state.phase !== 'starting' && root.tracked.has(rel)) { markEdited(); return; }
            generation++;
            root.pending.add(rel);
            if (root.pending.size > 2048) throw Error('Event queue limit');
            if (state.phase === 'starting') return;
            if (!root.git) { flush(root); return; }
            if (!root.scheduled) {
              root.scheduled = true;
              setImmediate(() => { root.scheduled = false; flush(root); });
            }
          }
        } catch (error) { fail('watch-event-failed', error); }
      });
      root.watcher.on('error', (error) => fail('watch-error', error));
      root.watcher.on('close', () => { if (!closing && !state.failed) fail('watch-closed'); });
    }
    const gitRoots = roots.filter(root => root.git);
    for (let index = 0; index < gitRoots.length; index += 2) {
      const batch = await Promise.allSettled(gitRoots.slice(index, index + 2).map(async root => {
        let tracked;
        if (gitRoots.length === 1) {
          const result = spawnSync('git', ['-C', root.path, 'ls-files', '--cached', '-z'], {
            encoding: 'utf8', windowsHide: true, timeout: 1000, maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
          });
          if (result.status !== 0) throw result.error ?? Error('Tracked path lookup failed');
          tracked = result.stdout;
        } else {
          tracked = (await readGitMetadata(root.path, ['ls-files', '--cached', '-z'], 4 * 1024 * 1024, startup.signal)).toString('utf8');
          if (closing) return;
        }
        for (const name of tracked.split('\0')) {
          if (!name) continue;
          root.tracked.add(name);
          for (let end = name.lastIndexOf('/'); end !== -1; end = name.lastIndexOf('/', end - 1)) {
            const parent = name.slice(0, end);
            if (root.tracked.has(parent)) break;
            root.tracked.add(parent);
          }
        }
      }));
      for (const result of batch) if (result.status === 'rejected') throw result.reason;
      if (closing) return;
    }
    await checkpoint(); if (!closing) { state.phase = 'ready'; state.action = 'prepared'; persist(); }
  } catch (error) { fail('watch-start-failed', error); }
});
