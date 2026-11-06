import { spawn, spawnSync } from 'node:child_process';
import { accessSync, appendFileSync, chmodSync, constants, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const runner = fileURLToPath(import.meta.url);
const model = 'gemini-3.8-flash-high';
const effort = 'high';
const startupGraceMs = 45_000;
const idleGraceMs = 12_000;
const successfulStop = new Set(['model_stop', 'NO_TOOL_CALL']);
const quotePowerShell = (value) => `'${value.replaceAll("'", "''")}'`;
const quoteShell = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function encodePowerShell(command) {
  return Buffer.from(command, 'utf16le').toString('base64');
}

function readJson(directory, name, optional = false) {
  try {
    return JSON.parse(readFileSync(join(directory, name), 'utf8'));
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  }
}

function writeJson(directory, name, value) {
  const temporary = join(directory, `${name}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, join(directory, name));
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
  if (process.platform === 'win32') {
    const argumentsLine = `"${runner}" run "${directory}"`;
    const command = `$ErrorActionPreference = 'Stop'\nStart-Process -FilePath ${quotePowerShell(process.execPath)} -ArgumentList ${quotePowerShell(argumentsLine)} -WindowStyle Normal`;
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(command)], { encoding: 'utf8', windowsHide: true });
  }

  const commandFile = join(directory, 'antigravity-worker.command');
  const command = [process.execPath, runner, 'run', directory].map(quoteShell).join(' ');
  writeFileSync(commandFile, `#!/bin/sh\nexec ${command}\n`, { mode: 0o700, flag: 'wx' });
  return spawnSync('/usr/bin/open', ['-a', 'Terminal', commandFile], { encoding: 'utf8' });
}

function hookConfig(directory) {
  const handler = (phase) => {
    const args = [process.execPath, runner, 'hook', directory, phase];
    if (process.platform !== 'win32') return { type: 'command', command: args.map(quoteShell).join(' '), timeout: 10 };
    const normalized = args.map((argument) => argument.replaceAll('\\', '/'));
    if (normalized.every((argument) => /^[\w:./-]+$/.test(argument))) {
      return { type: 'command', command: normalized.join(' '), timeout: 10 };
    }
    const encoded = encodePowerShell(`& ${args.map(quotePowerShell).join(' ')}; exit $LASTEXITCODE`);
    return { type: 'command', command: `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`, timeout: 10 };
  };
  return { PreInvocation: [handler('active')], Stop: [handler('stop')] };
}

function replaceConfig(target, bytes, mode, directory) {
  const temporary = `${target}.${basename(directory)}.tmp`;
  writeFileSync(temporary, bytes, { mode, flag: 'wx' });
  try {
    chmodSync(temporary, mode);
    renameSync(temporary, target);
  } catch (error) {
    unlinkSync(temporary);
    throw error;
  }
}

function installHooks(directory, cwd) {
  const configDirectory = join(cwd, '.agents');
  const createdDirectory = !lstatSync(configDirectory, { throwIfNoEntry: false });
  if (createdDirectory) mkdirSync(configDirectory);
  if (realpathSync(configDirectory) !== configDirectory) throw new Error('The .agents directory must be local to the worktree.');
  const target = join(configDirectory, 'hooks.json');
  const lock = join(configDirectory, '.codex-antigravity-worker.lock');
  writeFileSync(lock, directory, { flag: 'wx', mode: 0o600 });
  function release() {
    if (readFileSync(lock, 'utf8') !== directory) throw new Error(`Worker lock changed during execution: ${lock}`);
    unlinkSync(lock);
    if (createdDirectory) {
      try {
        rmdirSync(configDirectory);
      } catch (error) {
        if (error.code !== 'ENOTEMPTY') throw error;
      }
    }
  }
  let original;
  let installed;
  let mode;
  try {
    const existing = lstatSync(target, { throwIfNoEntry: false });
    if (existing && !existing.isFile()) throw new Error('The worktree hooks.json must be a regular file.');
    mode = existing ? existing.mode & 0o777 : 0o600;
    original = existing ? readFileSync(target) : null;
    const config = original ? JSON.parse(original.toString('utf8').replace(/^\uFEFF/, '')) : {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid worktree hooks.json.');
    const name = 'codex-antigravity-worker';
    if (Object.hasOwn(config, name)) throw new Error('A worker hook with this name already exists.');
    config[name] = hookConfig(directory);
    installed = Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
    if (original) writeFileSync(join(directory, 'original-hooks.json'), original, { mode: 0o600, flag: 'wx' });
    replaceConfig(target, installed, mode, directory);
  } catch (error) {
    release();
    throw error;
  }
  return () => {
    const current = lstatSync(target, { throwIfNoEntry: false });
    if (!current?.isFile() || !readFileSync(target).equals(installed)) {
      throw new Error(`Worker hook configuration changed during execution. Review ${target} and the backup in ${directory}.`);
    }
    if (original) replaceConfig(target, original, mode, directory);
    else unlinkSync(target);
    release();
  };
}

function start(worktree, promptFile, timeout = '1800') {
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Use Windows or macOS.');
  if (!isAbsolute(worktree) || !isAbsolute(promptFile)) throw new Error('Pass absolute worktree and prompt paths.');
  const cwd = realpathSync(worktree);
  if (!statSync(cwd).isDirectory() || !statSync(promptFile).isFile()) throw new Error('Expected a worktree directory and a prompt file.');
  const seconds = Number(timeout);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 14_400) throw new Error('Timeout must be 1 to 14400 seconds.');
  const prompt = readFileSync(promptFile, 'utf8').replace(/^\uFEFF/, '');
  if (!prompt.trim()) throw new Error('The prompt is empty.');
  if (process.platform === 'win32' && prompt.length > 12_000) throw new Error('Keep the initial Windows interactive prompt to 12,000 characters.');
  const agy = findAgy();
  const directory = mkdtempSync(join(tmpdir(), 'codex-agy-worker-'));
  const job = { cwd, agy, seconds, createdAt: Date.now() };
  writeJson(directory, 'job.json', job);
  const stagedPrompt = join(directory, 'prompt.txt');
  writeFileSync(stagedPrompt, prompt, { mode: 0o600, flag: 'wx' });
  try {
    const launched = launchTerminal(directory);
    if (launched.error || launched.status !== 0) {
      throw new Error(launched.error?.message || launched.stderr?.trim() || 'Could not open a worker terminal.');
    }
  } catch (error) {
    unlinkSync(stagedPrompt);
    writeJson(directory, 'result.json', { status: 'failed', error: error.message });
  }
  return status(directory);
}

function jobMarker(directory) {
  return `[Codex worker job ${basename(directory)}]`;
}

function recordHook(directory, phase) {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  const { conversationId, lastUserInput, terminationReason, fullyIdle, transcriptPath } = event;
  const previous = lastHookEvent(directory);
  const initialTask = typeof lastUserInput === 'string' && lastUserInput.includes(jobMarker(directory));
  if (typeof conversationId === 'string' && (previous ? previous.conversationId === conversationId : initialTask)) {
    appendFileSync(join(directory, 'events.jsonl'), `${JSON.stringify({
      phase, conversationId, terminationReason, fullyIdle, transcriptPath, timestamp: Date.now(),
    })}\n`, { mode: 0o600 });
  }
  process.stdout.write('{}');
}

function lastHookEvent(directory) {
  try {
    const records = readFileSync(join(directory, 'events.jsonl'), 'utf8');
    const lastLineEnd = records.lastIndexOf('\n');
    if (lastLineEnd < 0) return null;
    const start = records.lastIndexOf('\n', lastLineEnd - 1) + 1;
    return JSON.parse(records.slice(start, lastLineEnd));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function idleOutcome(directory, tuiOpen) {
  const event = lastHookEvent(directory);
  if (event?.phase !== 'stop' || event.fullyIdle !== true) return null;
  const { timestamp, transcriptPath, conversationId, terminationReason } = event;
  const transcript = transcriptPath && statSync(transcriptPath, { throwIfNoEntry: false });
  const lastActivity = Math.max(timestamp, transcript?.mtimeMs ?? 0);
  if (tuiOpen && Date.now() - lastActivity < idleGraceMs) return null;
  return {
    status: successfulStop.has(terminationReason) ? 'review-ready' : 'failed',
    tuiOpen, conversationId, terminationReason, transcriptPath, eventTimestamp: timestamp, transcriptTimestamp: transcript?.mtimeMs,
  };
}

function status(directory) {
  const job = readJson(directory, 'job.json');
  const result = readJson(directory, 'result.json', true);
  if (result) {
    const transcript = result.transcriptPath && statSync(result.transcriptPath, { throwIfNoEntry: false });
    if (result.status === 'review-ready' && transcript?.mtimeMs > result.transcriptTimestamp) {
      return { jobDirectory: directory, ...result, status: 'changed-after-handoff' };
    }
    return { jobDirectory: directory, ...result };
  }
  const started = statSync(join(directory, 'started'), { throwIfNoEntry: false });
  const elapsed = Date.now() - (started?.mtimeMs ?? job.createdAt);
  const state = started
    ? elapsed > job.seconds * 1000 + startupGraceMs ? 'wait-timeout' : 'running'
    : elapsed > startupGraceMs ? 'startup-timeout' : 'starting';
  return { jobDirectory: directory, status: state };
}

function display(text) {
  return stripVTControlCharacters(String(text ?? '')).replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '');
}

function runAgy(directory, job, prompt, restoreHooks) {
  const child = spawn(job.agy, [
    '--sandbox', '--dangerously-skip-permissions', '--model', model, '--effort', effort,
    // Explicitly select the existing worktree so CLI 1.5.2 loads its hooks before the initial prompt.
    '--add-dir', job.cwd,
    '-i', `${prompt}\n\nKeep the temporary worker hook and lock files in .agents unchanged.\n${jobMarker(directory)}`,
  ], { cwd: job.cwd, stdio: 'inherit' });
  let handedOff = false;
  function handoff(result) {
    if (handedOff) return;
    handedOff = true;
    try {
      restoreHooks();
    } catch (error) {
      result = { ...result, status: 'cleanup-needed', error: error.message };
    }
    writeJson(directory, 'result.json', result);
  }
  let interruption;
  const stopSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const interrupt = (signal) => {
    if (signal === 'SIGINT') return; // Antigravity handles Ctrl+C directly in its terminal.
    interruption = 'interrupted';
    child.kill('SIGKILL');
  };
  for (const signal of stopSignals) process.on(signal, interrupt);
  const deadline = Date.now() + job.seconds * 1000;
  const timer = setInterval(() => {
    const ready = idleOutcome(directory, true);
    if (ready) {
      clearInterval(timer);
      handoff(ready);
      return;
    }
    if (Date.now() < deadline) return;
    clearInterval(timer);
    interruption = 'timed-out';
    child.kill('SIGKILL');
  }, 1_000);

  return new Promise((resolve) => {
    let spawnError;
    child.once('error', (error) => {
      spawnError = error.message;
    });
    child.once('close', (exitCode, signal) => {
      clearInterval(timer);
      for (const signal of stopSignals) process.removeListener(signal, interrupt);
      const ready = !interruption && !spawnError && exitCode === 0 && idleOutcome(directory, false);
      handoff(ready ? { ...ready, exitCode, signal } : {
        status: interruption ?? 'failed', exitCode, signal, tuiOpen: false,
        error: spawnError ?? (!interruption ? 'Antigravity exited without a confirmed completion hook.' : undefined),
      });
      resolve();
    });
  });
}

async function run(directory) {
  const job = readJson(directory, 'job.json');
  mkdirSync(join(directory, 'started'), { mode: 0o700 });
  let result;
  try {
    const stagedPrompt = join(directory, 'prompt.txt');
    const prompt = readFileSync(stagedPrompt, 'utf8');
    unlinkSync(stagedPrompt);
    if (Date.now() - job.createdAt > startupGraceMs) {
      result = { status: 'startup-timeout', error: 'The terminal opened after the launch deadline.' };
    } else {
      console.log(`Antigravity worker | ${model} | effort ${effort}\n${display(job.cwd)}\n`);
      const restoreHooks = installHooks(directory, job.cwd);
      try {
        await runAgy(directory, job, prompt, restoreHooks);
      } catch (error) {
        restoreHooks();
        throw error;
      }
      result = readJson(directory, 'result.json');
    }
  } catch (error) {
    result = { status: 'failed', error: error.message };
  }
  if (!readJson(directory, 'result.json', true)) writeJson(directory, 'result.json', result);
  console.log(`\n\n[${result.status}] ${display(result.error ?? result.response)}`);
  if (process.stdin.isTTY) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    terminal.question('Press Enter to close this window.', () => terminal.close());
  }
}

try {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'start' && [2, 3].includes(args.length)) {
    console.log(JSON.stringify(start(...args)));
  } else if (action === 'status' && args.length === 1) {
    console.log(JSON.stringify(status(args[0])));
  } else if (action === 'run' && args.length === 1) {
    await run(args[0]);
  } else if (action === 'hook' && args.length === 2 && ['active', 'stop'].includes(args[1])) {
    recordHook(...args);
  } else {
    throw new Error('Usage: worker.mjs start <worktree> <prompt-file> [timeout-seconds] | status <job-directory>');
  }
} catch (error) {
  console.error(display(error.message));
  process.exitCode = 1;
}
