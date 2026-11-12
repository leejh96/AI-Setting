import { spawnSync } from 'node:child_process';
import { accessSync, constants, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { display, effort, installHooks, model, recordHook, runAgy, startupGraceMs } from './agy.mjs';
import { lockWorkspace, managedWorkspace, prepareWorkspace, removeWorkspace } from './workspace.mjs';

const runner = fileURLToPath(import.meta.url);
const requestFile = 'request.json';
const jobPrefix = 'codex-agy-worker-';
const jobName = /^codex-agy-worker-[a-z0-9]{6}$/i;
const retentionMs = 24 * 60 * 60 * 1000;
const finishedStatuses = new Set(['review-ready', 'changed-after-handoff', 'interrupted', 'timed-out', 'failed', 'startup-timeout']);
const quotePowerShell = (value) => `'${value.replace(/['\u2018-\u201b]/g, (char) => char + char)}'`;
const quoteShell = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const jobsDirectory = () => join(resolve(process.env.CODEX_HOME || join(homedir(), '.codex')), 'antigravity-worker', 'jobs');

function readOptional(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function readJson(directory, name) {
  const value = readOptional(join(directory, name));
  return value === null ? null : JSON.parse(value);
}

function writeJson(directory, name, value) {
  const temporary = join(directory, `${name}.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
  try {
    renameSync(temporary, join(directory, name));
  } catch (error) {
    unlinkSync(temporary);
    throw error;
  }
}

function findAgy() {
  const executable = process.platform === 'win32' ? 'agy.exe' : 'agy';
  const installDirectory = process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'agy', 'bin')
    : join(homedir(), '.local', 'bin');
  const directories = [...(process.env.PATH ?? '').split(delimiter), installDirectory];
  for (const entry of directories) {
    const directory = entry.replace(/^"|"$/g, '');
    if (!isAbsolute(directory)) continue;
    try {
      const candidate = join(directory, executable);
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    }
  }
  throw new Error('Antigravity CLI (agy) was not found on PATH.');
}

function launchTerminal(directory) {
  let launched;
  if (process.platform === 'win32') {
    const args = `"${runner}" serve "${directory}"`;
    const command = `$ErrorActionPreference = 'Stop'\nStart-Process -FilePath ${quotePowerShell(process.execPath)} -ArgumentList ${quotePowerShell(args)} -WindowStyle Normal`;
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    launched = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
      encoding: 'utf8', windowsHide: true, timeout: startupGraceMs,
    });
  } else if (process.platform === 'darwin') {
    const commandFile = join(directory, 'antigravity-worker.command');
    const command = [process.execPath, runner, 'serve', directory].map(quoteShell).join(' ');
    writeFileSync(commandFile, `#!/bin/sh\nexec ${command}\n`, { mode: 0o700, flag: 'wx' });
    launched = spawnSync('/usr/bin/open', ['-a', 'Terminal', commandFile], { encoding: 'utf8', timeout: startupGraceMs });
  } else {
    throw new Error('Use Windows or macOS.');
  }
  if (launched.error || launched.status !== 0) {
    throw new Error(launched.error?.message || launched.stderr?.trim() || 'Could not open a worker terminal.');
  }
}

function lockPath(cwd) {
  return join(cwd, '.agents', '.codex-antigravity-worker.lock');
}

function controlPath(job, action) {
  return join(job.terminalDirectory, `${action}-${basename(job.jobDirectory)}`);
}

function cleanupRecord(directory, name) {
  return lstatSync(join(directory, name), { throwIfNoEntry: false })?.isFile() ? readJson(directory, name) : null;
}

function cleanupJobs(directory, protectedTerminal) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); }
  catch { return; }
  const cutoff = Date.now() - retentionMs;
  const uid = process.getuid?.();
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory() || !jobName.test(entry.name)) continue;
    const path = join(directory, entry.name);
    try {
      const identity = lstatSync(path);
      if (!identity.isDirectory() || (uid !== undefined && identity.uid !== uid)) continue;
      const job = cleanupRecord(path, 'job.json');
      if (job?.jobDirectory !== path || typeof job.cwd !== 'string' || !isAbsolute(job.cwd)
          || typeof job.terminalDirectory !== 'string' || dirname(job.terminalDirectory) !== directory
          || !jobName.test(basename(job.terminalDirectory))) continue;
      const group = groups.get(job.terminalDirectory) ?? [];
      group.push({ job, identity });
      groups.set(job.terminalDirectory, group);
    } catch { /* Preserve records whose ownership or metadata cannot be read. */ }
  }
  for (const [terminal, group] of groups) {
    const initial = group.find(({ job }) => job.jobDirectory === terminal);
    if (!initial || terminal === protectedTerminal) continue;
    try {
      const closedAt = cleanupRecord(terminal, 'closed.json')?.timestamp;
      const pid = cleanupRecord(terminal, 'terminal.json')?.pid;
      if (!Number.isSafeInteger(closedAt) || closedAt > cutoff || !Number.isSafeInteger(pid) || pid <= 0
          || lstatSync(join(terminal, requestFile), { throwIfNoEntry: false })
          || lstatSync(lockPath(initial.job.cwd), { throwIfNoEntry: false })) continue;
      if (lstatSync(initial.job.cwd, { throwIfNoEntry: false }) && managedWorkspace(initial.job.cwd, directory)) continue;
      if (!group.every(({ job }) => {
        const result = cleanupRecord(job.jobDirectory, 'result.json');
        return job.cwd === initial.job.cwd && Number.isSafeInteger(job.createdAt)
          && finishedStatuses.has(result?.status) && (result.tuiOpen === undefined || result.tuiOpen === false)
          && Number.isSafeInteger(result.finishedAt) && result.finishedAt >= job.createdAt && result.finishedAt <= closedAt;
      })) continue;
      // Keep the terminal record until its follow-up records have been removed.
      for (const { job, identity } of [...group.filter(item => item !== initial), initial]) {
        const current = lstatSync(job.jobDirectory, { throwIfNoEntry: false });
        if (!current) continue;
        if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino) break;
        rmSync(job.jobDirectory, { recursive: true, force: true, maxRetries: 2 });
      }
    } catch { /* Uncertain records and inaccessible directories can be checked again on a later start. */ }
  }
}

function reserveWorktree(job) {
  const configDirectory = join(job.cwd, '.agents');
  let createdDirectory = false;
  try {
    mkdirSync(configDirectory);
    createdDirectory = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  if (realpathSync(configDirectory) !== configDirectory) throw new Error('The .agents directory must be local to the worktree.');
  const lock = lockPath(job.cwd);
  try {
    writeFileSync(lock, job.jobDirectory, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(`The worktree is locked by ${readOptional(lock) || 'another worker'}. Check ${lock}.`);
  }
  return () => {
    if (readOptional(lock) !== job.jobDirectory) throw new Error(`Worker lock changed during execution: ${lock}`);
    unlinkSync(lock);
    if (createdDirectory) {
      try {
        rmdirSync(configDirectory);
      } catch (error) {
        if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error;
      }
    }
  };
}

function readJob(directory) {
  if (!isAbsolute(directory)) throw new Error('Pass an absolute job directory.');
  const jobDirectory = realpathSync(directory);
  const job = readJson(jobDirectory, 'job.json');
  if (!job) throw new Error(`No job found in ${jobDirectory}.`);
  return { ...job, jobDirectory };
}

function terminalInfo(directory) {
  const terminal = readJson(directory, 'terminal.json');
  if (!terminal) return { terminalOpen: false };
  if (readJson(directory, 'closed.json')) return { terminalOpen: false, terminalPid: terminal.pid };
  try {
    process.kill(terminal.pid, 0);
    return { terminalOpen: true, terminalPid: terminal.pid };
  } catch (error) {
    if (error.code === 'ESRCH') return { terminalOpen: false, terminalPid: terminal.pid };
    if (error.code === 'EPERM') return { terminalOpen: null, terminalPid: terminal.pid };
    throw error;
  }
}

function legacyStatus(job, result) {
  const { jobDirectory, createdAt } = job;
  if (result) {
    const transcript = result.transcriptPath && statSync(result.transcriptPath, { throwIfNoEntry: false });
    const changed = result.status === 'review-ready' && transcript?.mtimeMs > result.transcriptTimestamp;
    return { jobDirectory, ...result, status: changed ? 'changed-after-handoff' : result.status };
  }
  const started = statSync(join(jobDirectory, 'started'), { throwIfNoEntry: false });
  const status = started ? 'running' : Date.now() - createdAt > startupGraceMs ? 'startup-timeout' : 'starting';
  return { jobDirectory, status };
}

function jobStatus(job) {
  const { jobDirectory, terminalDirectory, terminalReason, createdAt } = job;
  const result = readJson(jobDirectory, 'result.json');
  if (!terminalDirectory) return legacyStatus(job, result);
  const terminal = terminalInfo(terminalDirectory);
  const base = { jobDirectory, terminalDirectory, terminalReason, ...terminal };
  if (result) return { ...base, ...result };
  const progress = readJson(jobDirectory, 'progress.json');
  if (terminal.terminalPid && terminal.terminalOpen === false) {
    const lock = lockPath(job.cwd);
    const cleanup = readOptional(lock) === jobDirectory;
    return {
      ...base, ...progress, status: cleanup ? 'cleanup-needed' : 'terminal-lost',
      ...(cleanup && { lockPath: lock, hookPath: join(job.cwd, '.agents', 'hooks.json') }),
    };
  }
  if (progress) return { ...base, ...progress };
  const launchError = readJson(jobDirectory, 'launch-error.json');
  if (launchError) return { ...base, status: 'launch-failed', error: launchError.error };
  const expired = Date.now() - createdAt >= startupGraceMs;
  return { ...base, status: expired ? 'startup-timeout' : 'starting', phase: 'terminal-starting' };
}

export function status(directory) {
  return jobStatus(readJob(directory));
}

function readPrompt(promptFile) {
  if (!isAbsolute(promptFile) || !statSync(promptFile).isFile()) throw new Error('Pass an absolute prompt file path.');
  const prompt = readFileSync(promptFile, 'utf8').replace(/^\uFEFF/, '');
  if (!prompt.trim()) throw new Error('The prompt is empty.');
  if (process.platform === 'win32' && prompt.length > 12_000) throw new Error('Keep the Windows interactive prompt to 12,000 characters.');
  return prompt;
}

export function start(worktree, promptFile, options = {}) {
  if (!isAbsolute(worktree)) throw new Error('Pass an absolute worktree path.');
  const cwd = realpathSync(worktree);
  if (!statSync(cwd).isDirectory()) throw new Error('Expected a worktree directory.');
  const workspace = managedWorkspace(cwd, options.jobRoot ?? jobsDirectory());
  const unlock = workspace && lockWorkspace(workspace);
  try {
    return queueJob(cwd, promptFile, options);
  } finally {
    unlock?.();
  }
}

function queueJob(cwd, promptFile, { previous, newTerminal = false, launch = launchTerminal, locateAgy = findAgy, jobRoot = jobsDirectory() }) {
  const prompt = readPrompt(promptFile);
  const lock = lockPath(cwd);
  const owner = readOptional(lock);
  if (owner !== null) throw new Error(`The worktree is locked by ${owner || 'another worker'}. Check ${lock}.`);

  const storage = jobRoot;
  mkdirSync(storage, { recursive: true, mode: 0o700 });
  const info = lstatSync(storage);
  const uid = process.getuid?.();
  if (!info.isDirectory() || (uid !== undefined && (info.uid !== uid || (info.mode & 0o077)))) {
    throw new Error('Worker storage must be a private directory owned by the current user.');
  }
  const root = realpathSync(storage);
  let terminalDirectory;
  let terminalReason = newTerminal ? 'requested' : 'initial';
  if (previous) {
    const earlier = previous;
    if (earlier.cwd !== cwd) throw new Error('Follow-up must use the previous job’s worktree.');
    const prior = jobStatus(earlier);
    if (!readJson(earlier.jobDirectory, 'result.json') && !['terminal-lost', 'startup-timeout', 'launch-failed'].includes(prior.status)) {
      throw new Error(`The previous job is still pending or needs cleanup: ${prior.status}.`);
    }
    if (!newTerminal) {
      // The request is queued by hard link inside the selected storage root.
      const reusable = earlier.terminalDirectory && dirname(earlier.terminalDirectory) === root
        && prior.terminalReusable !== false && prior.status !== 'startup-timeout';
      if (reusable && prior.terminalOpen === null) throw new Error('Unable to verify the previous terminal from this session.');
      if (reusable && prior.terminalOpen) terminalDirectory = earlier.terminalDirectory;
      terminalReason = terminalDirectory ? 'reused' : 'previous-terminal-unavailable';
    }
  }
  const agy = locateAgy();
  cleanupJobs(root, previous?.terminalDirectory ?? previous?.jobDirectory);
  const jobDirectory = realpathSync(mkdtempSync(join(root, jobPrefix)));
  terminalDirectory ??= jobDirectory;
  const job = { cwd, agy, createdAt: Date.now(), jobDirectory, terminalDirectory, terminalReason };
  try {
    writeJson(jobDirectory, 'job.json', job);
    writeFileSync(join(jobDirectory, 'prompt.txt'), prompt, { mode: 0o600, flag: 'wx' });
    // A hard link publishes the whole request atomically and refuses to overwrite a queued job.
    linkSync(join(jobDirectory, 'job.json'), join(terminalDirectory, requestFile));
  } catch (error) {
    let cleanup = '';
    try {
      rmSync(jobDirectory, { recursive: true, force: true });
    } catch (cleanupError) {
      cleanup = ` Could not remove staged job ${jobDirectory}: ${cleanupError.message}`;
    }
    throw new Error(`Could not queue the job in ${terminalDirectory}: ${error.message}${cleanup}`, { cause: error });
  }
  if (terminalDirectory === jobDirectory) {
    try {
      launch(terminalDirectory);
    } catch (error) {
      writeJson(jobDirectory, 'launch-error.json', { error: error.message });
    }
  }
  return status(jobDirectory);
}

export async function followUp(previous, promptFile, options) {
  const earlier = readJob(previous);
  const current = jobStatus(earlier);
  if (earlier.terminalDirectory && current.tuiOpen && current.status === 'review-ready' && !current.finishedAt) {
    readPrompt(promptFile);
    await retireReviewed(earlier, current);
  }
  return start(earlier.cwd, promptFile, { ...options, previous: earlier });
}

async function retireReviewed(job, current) {
  if (!current.terminalOpen) throw new Error('Unable to confirm the previous terminal is open.');
  const deadline = Date.now() + 15_000;
  writeJson(job.terminalDirectory, basename(controlPath(job, 'retire')), {
    eventTimestamp: current.eventTimestamp, expiresAt: deadline,
  });
  while (!readJson(job.jobDirectory, 'result.json')) {
    const state = jobStatus(job);
    const stillReviewed = state.status === 'review-ready' && state.eventTimestamp === current.eventTimestamp;
    if (Date.now() >= deadline || (!stillReviewed && state.status !== 'stopping')) {
      throw new Error('Could not close the previous Antigravity screen safely. Check its status before retrying.');
    }
    await delay(100);
  }
}

export async function finish(directory, published, jobs = jobsDirectory()) {
  jobs = realpathSync(jobs);
  const job = readJob(directory);
  if (dirname(job.jobDirectory) !== jobs || !jobName.test(basename(job.jobDirectory))) throw new Error('Expected a local worker job.');
  const workspace = managedWorkspace(job.cwd, jobs);
  if (!workspace) throw new Error('Only a workspace created by prepare can be removed.');
  const unlock = lockWorkspace(workspace);
  try {
    for (const entry of readdirSync(jobs, { withFileTypes: true })) {
      if (!entry.isDirectory() || !jobName.test(entry.name)) continue;
      const path = join(jobs, entry.name);
      if (path === job.jobDirectory) continue;
      const other = cleanupRecord(path, 'job.json');
      if (other?.cwd !== job.cwd) continue;
      const result = cleanupRecord(path, 'result.json');
      if (other.createdAt >= job.createdAt || !finishedStatuses.has(result?.status) || result.tuiOpen === true || !result.finishedAt) {
        throw new Error('Another job for this workspace is active, newer or needs cleanup.');
      }
    }
    const current = jobStatus(job);
    if (current.status !== 'review-ready') throw new Error('The worker result is not ready to finish.');
    if (!current.finishedAt) await retireReviewed(job, current);
    const result = jobStatus(job);
    if (result.status !== 'review-ready' || result.tuiOpen !== false || !result.finishedAt || lstatSync(lockPath(job.cwd), { throwIfNoEntry: false })) {
      throw new Error('The worker screen and workspace lock have not been safely released.');
    }
    removeWorkspace(workspace, published);
  } finally {
    unlock();
  }
  rmdirSync(workspace.directory);
  return { status: 'workspace-removed', cwd: workspace.cwd };
}

export function cancel(directory) {
  const job = readJob(directory);
  const current = status(directory);
  if (!current.terminalOpen || current.finishedAt || !['starting', 'agy-starting', 'agy-running', 'agy-settling', 'review-ready', 'changed-after-handoff', 'stopping'].includes(current.status)) {
    throw new Error(`The worker cannot be cancelled in state ${current.status}.`);
  }
  writeFileSync(controlPath(job, 'cancel'), '', { mode: 0o600 });
  return status(directory);
}

async function execute(job, controller, retire, run) {
  const { jobDirectory, cwd } = job;
  let release;
  let restore;
  let outcome;
  try {
    const staged = join(jobDirectory, 'prompt.txt');
    const prompt = readFileSync(staged, 'utf8');
    unlinkSync(staged);
    if (Date.now() - job.createdAt >= startupGraceMs) return { status: 'startup-timeout', phase: 'terminal-starting' };
    if (controller.signal.aborted) return { status: 'interrupted', phase: 'terminal-starting' };
    release = reserveWorktree(job);
    restore = installHooks(job, runner);
    console.log(`\n[${basename(jobDirectory)}] ${display(job.terminalReason)}\n${display(cwd)}\n`);
    outcome = await run(job, prompt, (progress) => writeJson(jobDirectory, 'progress.json', progress), controller.signal, { retireRequests: retire });
  } catch (error) {
    outcome = { status: 'failed', error: error.message };
  }
  if (release && outcome.status !== 'cleanup-needed') {
    try {
      restore?.();
      release();
    } catch (error) {
      outcome = { ...outcome, status: 'cleanup-needed', error: error.message };
    }
  }
  if (outcome.status === 'cleanup-needed') {
    outcome.lockPath = lockPath(cwd);
    outcome.hookPath = join(cwd, '.agents', 'hooks.json');
  }
  return outcome;
}

export function serve(directory, run = runAgy) {
  const terminal = readJob(directory);
  const terminalDirectory = terminal.jobDirectory;
  if (terminal.terminalDirectory !== terminalDirectory) throw new Error('Expected the initial job directory for this terminal.');
  // A directory is an exclusive claim even if the same launcher is invoked twice.
  mkdirSync(join(terminalDirectory, 'serving'), { mode: 0o700 });
  writeJson(terminalDirectory, 'terminal.json', { pid: process.pid });
  console.log(`Antigravity worker | ${model} | effort ${effort}\nCtrl+D exits the Antigravity screen. Ctrl+C closes the idle worker terminal.`);
  let active;
  let closing = false;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const watcher = watch(terminalDirectory, (event, filename) => {
    if (!filename || filename === requestFile || /^(cancel|retire)-/.test(filename)) receive();
  });
  watcher.on('error', (error) => {
    console.error(display(error.message));
    close();
  });

  function close() {
    closing = true;
    if (active) {
      active.controller.abort();
      return;
    }
    watcher.close();
    for (const signal of signals) process.removeListener(signal, onSignal[signal]);
    writeJson(terminalDirectory, 'closed.json', { timestamp: Date.now() });
  }

  const onSignal = {
    SIGINT: () => { if (!active) close(); },
    SIGTERM: close,
    SIGHUP: close,
  };
  for (const signal of signals) process.on(signal, onSignal[signal]);

  function receive() {
    if (closing) return;
    try {
      if (active) {
        if (readOptional(active.cancelFile) !== null) active.controller.abort();
        else {
          const request = readOptional(active.retireFile);
          if (request !== null) {
            unlinkSync(active.retireFile);
            if (request) active.retire.dispatchEvent(new CustomEvent('retire', { detail: JSON.parse(request) }));
          }
        }
        return;
      }
      const slot = join(terminalDirectory, requestFile);
      const job = readJson(terminalDirectory, requestFile);
      if (!job) return;
      if (job.terminalDirectory !== terminalDirectory || job.cwd !== terminal.cwd) throw new Error('Invalid request for this terminal.');
      const controller = new AbortController();
      const retire = new EventTarget();
      const cancelFile = controlPath(job, 'cancel');
      if (readOptional(cancelFile) !== null) controller.abort();
      active = { cancelFile, retireFile: controlPath(job, 'retire'), controller, retire };
      execute(job, controller, retire, run).then((result) => {
        unlinkSync(slot);
        writeJson(job.jobDirectory, 'result.json', { ...result, finishedAt: Date.now() });
        if (result.terminalReusable === false) closing = true;
        console.log(`\n[${result.status}] ${display(result.error ?? result.phase)}`);
      }).catch((error) => {
        console.error(display(error.message));
        closing = true;
      }).finally(() => {
        active = undefined;
        if (closing) close();
        else receive();
      });
    } catch (error) {
      console.error(display(error.message));
      close();
    }
  }

  receive();
  return close;
}

if (process.argv[1] && resolve(process.argv[1]) === runner) {
  try {
    const [action, ...args] = process.argv.slice(2);
    if (action === 'prepare' && args.length <= 1) console.log(JSON.stringify(prepareWorkspace(jobsDirectory(), args[0])));
    else if (action === 'start' && args.length === 2) console.log(JSON.stringify(start(args[0], args[1])));
    else if (action === 'follow-up' && (args.length === 2 || (args.length === 3 && args[2] === '--new-terminal'))) {
      console.log(JSON.stringify(await followUp(args[0], args[1], { newTerminal: args[2] === '--new-terminal' })));
    }
    else if (action === 'finish' && args.length >= 1 && args.length <= 2) console.log(JSON.stringify(await finish(args[0], args[1])));
    else if (action === 'status' && args.length === 1) console.log(JSON.stringify(status(args[0])));
    else if (action === 'cancel' && args.length === 1) console.log(JSON.stringify(cancel(args[0])));
    else if (action === 'serve' && args.length === 1) serve(args[0]);
    else if (action === 'hook' && args.length === 2 && ['active', 'stop'].includes(args[1])) {
      recordHook(args[0], args[1], JSON.parse(readFileSync(0, 'utf8')));
      process.stdout.write('{}');
    }
    else throw new Error('Usage: worker.mjs prepare [original-worktree] | start <worktree> <prompt> | follow-up <job> <prompt> [--new-terminal] | finish <job> [published-directory] | status <job> | cancel <job>');
  } catch (error) {
    console.error(display(error.message));
    process.exitCode = 1;
  }
}
