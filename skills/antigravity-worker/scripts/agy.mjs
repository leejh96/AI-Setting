import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync, renameSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { stripVTControlCharacters } from 'node:util';

export const model = 'gemini-3.8-flash-high';
export const effort = 'high';
export const startupGraceMs = 45_000;
const hookName = 'codex-antigravity-worker';
const successfulStops = new Set(['model_stop', 'NO_TOOL_CALL']);
const marker = (directory) => '[Codex worker job ' + basename(directory) + ']';

export function display(value) {
  return stripVTControlCharacters(String(value ?? '')).replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '');
}

function hookCommand(args) {
  if (process.platform !== 'win32') {
    return args.map((arg) => "'" + arg.replaceAll("'", "'\\''") + "'").join(' ');
  }
  const normalized = args.map((arg) => arg.replaceAll('\\', '/'));
  if (normalized.every((arg) => /^[\w:./-]+$/.test(arg))) return normalized.join(' ');
  const quoted = args.map((arg) => "'" + arg.replace(/['\u2018-\u201b]/g, (char) => char + char) + "'");
  const encoded = Buffer.from('& ' + quoted.join(' ') + '; exit $LASTEXITCODE', 'utf16le').toString('base64');
  return 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + encoded;
}

export function installHooks(job, runner) {
  const { cwd, jobDirectory } = job;
  const target = join(cwd, '.agents', 'hooks.json');
  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing && !existing.isFile()) throw new Error('The worktree hooks.json must be a regular file.');
  const original = existing ? readFileSync(target) : null;
  const config = original ? JSON.parse(original.toString('utf8').replace(/^\uFEFF/, '')) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid worktree hooks.json.');
  if (Object.hasOwn(config, hookName)) throw new Error('A worker hook with this name already exists.');
  const handler = (phase) => ({
    type: 'command', command: hookCommand([process.execPath, runner, 'hook', jobDirectory, phase]), timeout: 10,
  });
  config[hookName] = { PreInvocation: [handler('active')], Stop: [handler('stop')] };
  const installed = Buffer.from(JSON.stringify(config, null, 2) + '\n');
  const backup = join(jobDirectory, 'original-hooks.json');
  const mode = existing ? existing.mode & 0o777 : 0o600;
  if (original) writeFileSync(backup, original, { mode: 0o600, flag: 'wx' });
  replace(installed);

  function replace(bytes) {
    const temporary = target + '.' + basename(jobDirectory) + '.tmp';
    writeFileSync(temporary, bytes, { mode, flag: 'wx' });
    try {
      chmodSync(temporary, mode);
      renameSync(temporary, target);
    } catch (error) {
      unlinkSync(temporary);
      throw error;
    }
  }
  return () => {
    if (!lstatSync(target, { throwIfNoEntry: false })?.isFile() || !readFileSync(target).equals(installed)) {
      throw new Error('Worker hook configuration changed. Review ' + target + (original ? ' and the backup ' + backup : '') + '.');
    }
    if (original) replace(original);
    else unlinkSync(target);
  };
}

export function recordHook(directory, phase, payload) {
  const { conversationId, lastUserInput, terminationReason, fullyIdle, transcriptPath, executionNum, invocationNum } = payload;
  if (typeof conversationId !== 'string' || !conversationId) return;
  const event = {
    phase, conversationId, terminationReason, fullyIdle, transcriptPath, executionNum, invocationNum, timestamp: Date.now(),
    matches: typeof lastUserInput === 'string' && lastUserInput.includes(marker(directory)),
    hasInput: typeof lastUserInput === 'string' && lastUserInput.length > 0,
  };
  appendFileSync(join(directory, 'events.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 });
}

function processSnapshot() {
  const output = execFileSync('/bin/ps', ['-ax', '-o', 'pid=', '-o', 'ppid=', '-o', 'stat='], {
    encoding: 'utf8', timeout: 2_000,
  });
  return new Map(output.trim().split('\n').map((line) => {
    const [pid, parent, state] = line.trim().split(/\s+/);
    return [Number(pid), { parent: Number(parent), state: state[0] }];
  }));
}

function sendSignal(pid, signal) {
  try {
    return process.kill(pid, signal);
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

export async function stopPosixTree(pid, { snapshot = processSnapshot, send = sendSignal, timeoutMs = 4_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const owned = new Set();
  const paused = new Set();
  let processes = snapshot();
  if (!processes.has(pid)) throw new Error('Antigravity exited before its child processes could be checked.');

  function freeze(target, state) {
    if (state === 'Z') return false;
    if (state !== 'T') {
      if (!send(target, 'SIGSTOP')) return false;
      paused.add(target);
    }
    owned.add(target);
    return true;
  }

  function freezeChildren() {
    let foundChild = false;
    for (const [target, { parent, state }] of processes) {
      if (owned.has(parent) && !owned.has(target) && freeze(target, state)) foundChild = true;
    }
    return foundChild;
  }

  // Keep the interactive process attached to its terminal and stop forks before taking the final snapshot.
  try {
    if (!freeze(pid, processes.get(pid).state)) throw new Error('Could not pause Antigravity to inspect its child processes.');
    freezeChildren();
    while (true) {
      processes = snapshot();
      if (!processes.has(pid) || processes.get(pid).state === 'Z') throw new Error('Antigravity exited during its process tree inspection.');
      const foundChild = freezeChildren();
      if (!foundChild && [...owned].every((target) => !processes.has(target) || ['T', 'Z'].includes(processes.get(target).state))) break;
      if (Date.now() >= deadline) throw new Error('Could not confirm that the Antigravity process tree was paused.');
      await delay(25);
    }

    for (const target of [...owned].reverse()) {
      if (processes.has(target) && processes.get(target).state !== 'Z') send(target, 'SIGKILL');
    }
    while ([...owned].some((target) => processes.has(target) && processes.get(target).state !== 'Z')) {
      if (Date.now() >= deadline) throw new Error('Could not confirm that the Antigravity process tree exited.');
      await delay(25);
      processes = snapshot();
    }
  } catch (error) {
    for (const target of paused) {
      try { send(target, 'SIGCONT'); } catch { /* Cleanup remains necessary. */ }
    }
    throw error;
  }
}

function stopProcess(pid) {
  if (process.platform !== 'win32') return stopPosixTree(pid);
  return new Promise((resolve, reject) => {
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    const killer = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      killer.kill();
      reject(new Error('Timed out waiting for taskkill to stop PID ' + pid + '.'));
    }, 5_000);
    killer.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    killer.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('taskkill exited with code ' + code + ' for PID ' + pid + '.'));
    });
  });
}

function saveTerminalMode() {
  if (process.platform !== 'darwin' || !process.stdin.isTTY) return undefined;
  const stty = (...args) => execFileSync('/bin/stty', args, { stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8', timeout: 2_000 });
  const mode = stty('-g').trim();
  return () => stty(mode);
}

export function runAgy(job, prompt, report, signal, {
  spawnChild = spawn, terminate = stopProcess, startupMs = startupGraceMs, settleMs = 750, retireRequests,
  saveTerminal = saveTerminalMode,
} = {}) {
  const restoreTerminal = saveTerminal();
  const eventPath = join(job.jobDirectory, 'events.jsonl');
  writeFileSync(eventPath, '', { flag: 'wx', mode: 0o600 });
  const content = prompt + '\n\nPreserve .agents/hooks.json and the worker lock. Wait for any work you start to finish before responding.\n' + marker(job.jobDirectory);
  const watcher = watch(eventPath, { persistent: false });
  let child;
  try {
    child = spawnChild(job.agy, [
      '--sandbox', '--dangerously-skip-permissions', '--model', model, '--effort', effort,
      '--add-dir', job.cwd, '-i', content,
    ], { cwd: job.cwd, stdio: 'inherit' });
  } catch (error) {
    watcher.close();
    throw error;
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let position = 0;
    let conversationId;
    let phase = 'agy-starting';
    let timer;
    let settling;
    let stopTimer;
    let workDeadlineAt;
    let stopping;
    let candidate;
    let reviewed;
    let manualActivity = false;
    let manualIdle = false;
    let spawnError;
    let finished = false;
    let lastInvocation = -1;
    let lastExecution = -1;

    function progress(status, details = {}) {
      try {
        report({ status, phase, workerPid: child.pid, startedAt, eventPath, ...details });
      } catch (error) {
        stop({ status: 'failed', error: 'Cannot publish worker status: ' + error.message });
      }
    }

    function complete(outcome) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(settling);
      clearTimeout(stopTimer);
      signal.removeEventListener('abort', interrupt);
      retireRequests?.removeEventListener('retire', retire);
      watcher.close();
      if (restoreTerminal && outcome.tuiOpen === false) {
        try {
          restoreTerminal();
        } catch (error) {
          outcome = { ...outcome, terminalReusable: false, terminalError: error.message };
        }
      }
      resolve({ phase, workerPid: child.pid, eventPath, tuiOpen: outcome.status === 'cleanup-needed' ? null : false, ...outcome });
    }

    function stop(outcome) {
      if (stopping || finished) return;
      clearTimeout(timer);
      clearTimeout(settling);
      stopping = Promise.resolve().then(() => child.pid && terminate(child.pid)).then(
        () => outcome,
        (error) => ({ ...outcome, status: 'cleanup-needed', error: error.message }),
      );
      stopTimer = setTimeout(async () => {
        child.unref();
        complete({ ...await stopping, status: 'cleanup-needed', error: 'Antigravity process exit could not be confirmed.' });
      }, 10_000);
      if (outcome.status !== 'failed') progress('stopping');
    }

    function deadline(ms) {
      if (stopping) return;
      clearTimeout(timer);
      const watchdog = setTimeout(() => {
        receive();
        if (timer === watchdog && !reviewed && !candidate && !manualActivity) stop({ status: 'timed-out' });
      }, ms);
      timer = watchdog;
    }

    function accept(event) {
      if (stopping) return;
      if (!conversationId && event.matches) conversationId = event.conversationId;
      if (event.conversationId !== conversationId) return;
      if (event.hasInput && !event.matches) {
        manualActivity = true;
        manualIdle = event.phase === 'stop' && event.fullyIdle === true && successfulStops.has(event.terminationReason);
        reviewed = candidate = undefined;
        clearTimeout(settling);
        clearTimeout(timer);
        progress('changed-after-handoff', { tuiOpen: true });
        return;
      }
      if (manualActivity) return;
      if (phase === 'agy-starting') {
        phase = 'agy-running';
        workDeadlineAt = Date.now() + job.seconds * 1000;
        progress(phase);
        deadline(Math.max(0, workDeadlineAt - Date.now()));
      }
      if (event.phase === 'active') {
        if (Number.isInteger(event.invocationNum)) {
          if (event.invocationNum <= lastInvocation) return;
          lastInvocation = event.invocationNum;
        }
        if (!candidate && !reviewed) return;
        reviewed = candidate = undefined;
        clearTimeout(settling);
        phase = 'agy-running';
        progress(phase);
        deadline(Math.max(0, workDeadlineAt - Date.now()));
        return;
      }
      if (event.fullyIdle !== true || candidate || reviewed) return;
      if (Number.isInteger(event.executionNum)) {
        if (event.executionNum <= lastExecution) return;
        lastExecution = event.executionNum;
      }
      candidate = {
        status: successfulStops.has(event.terminationReason) ? 'review-ready' : 'failed',
        conversationId, transcriptPath: event.transcriptPath, terminationReason: event.terminationReason,
        eventTimestamp: event.timestamp,
      };
      phase = 'agy-settling';
      progress(phase);
      settling = setTimeout(() => {
        receive();
        if (!candidate || stopping) return;
        if (candidate.status !== 'review-ready') {
          stop(candidate);
          return;
        }
        clearTimeout(timer);
        reviewed = candidate;
        candidate = undefined;
        phase = 'agy-review';
        progress('review-ready', { ...reviewed, tuiOpen: true });
      }, settleMs);
    }

    function receive() {
      if (stopping || finished) return;
      try {
        const fd = openSync(eventPath, 'r');
        try {
          const available = fstatSync(fd).size - position;
          if (available <= 0) return;
          const buffer = Buffer.alloc(available);
          const count = readSync(fd, buffer, 0, available, position);
          const end = buffer.lastIndexOf(10, count - 1);
          if (count === 0 || end < 0) return;
          position += end + 1;
          for (const line of buffer.toString('utf8', 0, end).split('\n')) accept(JSON.parse(line));
        } finally {
          closeSync(fd);
        }
      } catch (error) {
        stop({ status: 'failed', error: error.message });
      }
    }

    function interrupt() {
      stop({ status: 'interrupted' });
    }

    function retire(event) {
      receive();
      const { eventTimestamp, expiresAt } = event.detail;
      if (reviewed && reviewed.eventTimestamp === eventTimestamp && Date.now() < expiresAt) stop(reviewed);
    }

    watcher.on('change', receive);
    watcher.on('error', (error) => stop({ status: 'failed', error: error.message }));
    child.once('error', (error) => { spawnError = error.message; });
    child.once('close', async (exitCode, exitSignal) => {
      if (finished) return;
      receive();
      const exit = { exitCode, signal: exitSignal, tuiOpen: false };
      if (stopping) {
        complete({ ...await stopping, ...exit });
        return;
      }
      const stopEvent = reviewed ?? candidate;
      const crashed = exitCode !== 0 || exitSignal;
      const outcome = spawnError ? { status: 'failed', error: spawnError }
        : manualActivity ? { status: 'changed-after-handoff' }
        : crashed ? {
          ...stopEvent,
          status: 'failed', error: `Antigravity exited unexpectedly (${exitSignal ?? `code ${exitCode}`}).`,
        }
        : stopEvent ?? { status: 'completion-missing', error: 'Antigravity closed without a matching completed Stop hook.' };
      const cleanExit = !spawnError && !crashed && (manualActivity ? manualIdle : stopEvent?.status === 'review-ready');
      // Once the CLI has exited, detached children can no longer be found by walking its process tree.
      if (child.pid && !cleanExit) {
        complete({
          ...outcome, ...exit, status: 'cleanup-needed', exitStatus: outcome.status,
          error: (outcome.error ? outcome.error + ' ' : '') + 'Child process exit could not be confirmed.',
        });
      } else {
        complete({ ...outcome, ...exit });
      }
    });
    signal.addEventListener('abort', interrupt, { once: true });
    retireRequests?.addEventListener('retire', retire);
    progress(phase);
    deadline(startupMs);
    if (signal.aborted) interrupt();
  });
}
