import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs, stripVTControlCharacters } from 'node:util';
import { lockWorkspace, managedWorkspace } from './workspace.mjs';
import { configureSession, connect, defaultEffort, defaultModel, openSession } from './acp.mjs';
import { finalizeResult, prepareResult, removeGitWorkspace, reviewResult } from './results.mjs';

const jobPrefix = 'codex-agy-acp-';
const jobsRoot = () => join(resolve(process.env.CODEX_HOME || join(homedir(), '.codex')), 'antigravity-worker', 'worktrees');
const emit = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));

function agyExecutable() {
  const installed = join(homedir(), '.local', 'bin', 'agy');
  return process.platform !== 'win32' && existsSync(installed) ? installed : 'agy';
}

function connectWorker(cwd, profile, logs, onUpdate = () => {}) {
  return connect(agyExecutable(), cwd, profile, join(logs, 'agy.log'), join(logs, 'stderr.log'), onUpdate);
}

function updateCli() {
  const executable = agyExecutable();
  const result = spawnSync(executable, ['update'], {
    cwd: tmpdir(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 120_000,
  });
  const report = stripVTControlCharacters([result.stdout, result.stderr].filter(Boolean).join('\n')).trim();
  if (result.error) throw new Error(`Antigravity update could not run (${result.error.code}).`);
  if (result.status !== 0) throw new Error(report || `Antigravity update failed (${result.signal ?? result.status}).`);
  const version = spawnSync(executable, ['--version'], {
    cwd: tmpdir(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 10_000,
  });
  if (version.error || version.status !== 0 || !version.stdout?.trim()) {
    throw new Error('Could not verify the installed Antigravity version after update.');
  }
  emit('cli-updated', { version: version.stdout.trim(), report });
}

function quota() {
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'codex-agy-acp-quota-'));
  try {
    const result = spawnSync(agyExecutable(), ['-p', '/usage', '--print-timeout', '15s'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 25_000,
    });
    if (result.error) throw new Error(`Antigravity quota lookup could not run (${result.error.code}).`);
    if (result.status !== 0) throw new Error(`Antigravity quota lookup failed (${result.signal ?? result.status}).`);
    const report = stripVTControlCharacters(result.stdout).trim();
    if (!report) throw new Error('Antigravity returned no quota report.');
    emit('quota', { report });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function capabilities(path = process.cwd()) {
  if (!isAbsolute(path) || !lstatSync(realpathSync(path)).isDirectory()) throw new Error('Pass an absolute workspace directory.');
  const cwd = realpathSync(path);
  const temporary = mkdtempSync(join(realpathSync(tmpdir()), 'codex-agy-acp-capabilities-'));
  const profile = join(temporary, 'gemini');
  let client;
  try {
    mkdirSync(profile, { mode: 0o700 });
    client = connectWorker(cwd, profile, temporary);
    const session = await openSession(client, cwd);
    const commands = await client.listCommands(session.sessionId);
    if (session.canClose) await client.request('session/close', { sessionId: session.sessionId }, 5_000);
    emit('capabilities', { cwd, agent: session.agent, options: session.options, models: session.availableModels, commands });
  } finally {
    await client?.shutdown();
    rmSync(temporary, { recursive: true, force: true });
  }
}

function save(job, status) {
  const temporary = join(job, `status.${process.pid}.tmp`);
  writeFileSync(temporary, JSON.stringify(status) + '\n', { mode: 0o600 });
  renameSync(temporary, join(job, 'status.json'));
}

function readJob(path) {
  if (!isAbsolute(path ?? '') || !lstatSync(path).isDirectory()) throw new Error('Pass the absolute ACP job path.');
  const job = realpathSync(path);
  const root = jobsRoot();
  const parent = dirname(job);
  if (!/^codex-agy-acp-[a-z0-9]{6}$/i.test(basename(job)) || (parent !== realpathSync(tmpdir())
      && (!existsSync(root) || parent !== realpathSync(root)))) throw new Error('Expected an ACP job from prepare.');
  return { job, state: JSON.parse(readFileSync(join(job, 'status.json'), 'utf8')) };
}

function prepare(target, copy) {
  const root = jobsRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const job = mkdtempSync(join(realpathSync(root), jobPrefix));
  let workspace;
  try {
    workspace = prepareResult(job, target, copy);
  } catch (error) {
    if (!existsSync(join(job, 'workspaces'))) rmSync(job, { recursive: true, force: true });
    else throw new Error(`${error.message} Check the temporary job at ${job}.`);
    throw error;
  }
  const state = { ...workspace, status: 'prepared' };
  save(job, state);
  emit('prepared', { job, ...state });
}

function workspaceFor(job, state) {
  const workspace = managedWorkspace(state.cwd, job);
  if (!workspace) throw new Error('The job workspace is missing or its identity changed.');
  if (existsSync(join(state.cwd, '.agents', '.codex-antigravity-worker.lock'))) {
    throw new Error('The terminal worker holds a lock in this workspace.');
  }
  return workspace;
}

async function promptWorker(job, previous, action, promptPath, { edit, model, effort }) {
  if (!isAbsolute(promptPath ?? '')) throw new Error('Pass an absolute UTF-8 prompt file path.');
  const prompt = readFileSync(promptPath, 'utf8').trim();
  if (!prompt) throw new Error('The prompt file is empty.');
  const unlock = lockWorkspace(workspaceFor(job, previous));
  const state = { ...previous, status: 'starting', stopReason: null, error: null, runnerPid: process.pid, workerPid: null };
  let client;
  let session;
  let responseReceived = false;
  let sent = false;
  let cancelTimer;
  let cancelPoll;
  let cancelSent = false;
  const { promise: cancelDeadline, reject: cancelExpired } = Promise.withResolvers();

  function cancel() {
    if (!sent || responseReceived || cancelSent) return;
    cancelSent = true;
    try {
      client.cancel(session.sessionId);
      emit('cancel-requested', { sessionId: session.sessionId });
      cancelTimer = setTimeout(() => cancelExpired(new Error('ACP did not acknowledge cancellation.')), 15_000);
    } catch (error) {
      cancelExpired(error);
    }
  }

  try {
    // A separate invocation may have finished a turn after we first read status.
    const current = readJob(job).state;
    if (current.turn !== previous.turn || current.status !== previous.status) {
      throw new Error('Job status changed. Inspect status and retry.');
    }
    if (action === 'follow-up' ? !current.sessionId : Boolean(current.sessionId)) {
      throw new Error('Use start for a new session and follow-up for an existing session.');
    }
    if (['cleanup-needed', 'starting', 'running', 'workspace-removed'].includes(current.status)) {
      throw new Error(`Job requires inspection: ${current.status}.`);
    }
    if (existsSync(join(job, 'finalized.json'))) throw new Error('Retry finish to complete the approved cleanup.');
  } catch (error) {
    unlock();
    throw error;
  }

  try {
    const turn = mkdtempSync(join(job, 'turn-'));
    const profile = join(job, 'gemini');
    mkdirSync(profile, { mode: 0o700, recursive: true });
    const transcript = join(turn, 'response.txt');
    const events = join(turn, 'events.jsonl');
    writeFileSync(transcript, '', { mode: 0o600 });
    writeFileSync(events, '', { mode: 0o600 });
    state.turn = turn;
    save(job, state);
    emit('starting', { job, cwd: state.cwd, turn });

    let denied = 0;
    client = connectWorker(state.cwd, profile, turn, (id, update) => {
      if (!session || id !== session.sessionId) return;
      const kind = update.sessionUpdate;
      if (kind === 'available_commands_update' && Array.isArray(update.availableCommands)) {
        if (!sent) return; // The connection caches setup notifications until the turn starts.
        state.commands = update.availableCommands;
        save(job, state);
        emit('available-commands', { commands: state.commands });
        return;
      }
      if (!sent || responseReceived) return;
      if (kind === 'agent_message_chunk' && update.content?.type === 'text') {
        appendFileSync(transcript, update.content.text);
      } else if (['tool_call', 'tool_call_update', 'permission_denied'].includes(kind)) {
        if (kind === 'permission_denied') denied++;
        const data = { event: kind, title: update.title, status: update.status, toolCallId: update.toolCallId };
        appendFileSync(events, JSON.stringify(data) + '\n');
        emit(kind, data);
      }
    });
    state.workerPid = client.pid ?? null;
    save(job, state);
    session = await openSession(client, state.cwd, previous.sessionId);
    const previousModel = previous.settings?.model ?? defaultModel;
    const selectedModel = model ?? previousModel;
    const selectedEffort = effort ?? (selectedModel === previousModel
      ? (previous.settings ? previous.settings.thought_level : defaultEffort)
      : undefined);
    const mode = edit ? 'accept-edits' : 'default';
    await configureSession(client, session, {
      model: selectedModel, ...(selectedEffort === undefined ? {} : { thought_level: selectedEffort }), mode,
    });
    const activeEffort = session.options.find(option => option.id === 'thought_level')?.currentValue;
    state.sessionId = session.sessionId;
    state.status = 'running';
    state.settings = { model: selectedModel, ...(activeEffort === undefined ? {} : { thought_level: activeEffort }), mode };
    state.agent = session.agent;
    state.commands = client.commandsFor(session.sessionId) ?? previous.commands ?? null;
    save(job, state);
    emit('running', { sessionId: state.sessionId, settings: state.settings, agent: state.agent });
    if (state.commands) emit('available-commands', { commands: state.commands });

    process.on('SIGINT', cancel);
    process.on('SIGTERM', cancel);
    cancelPoll = setInterval(() => {
      if (existsSync(join(turn, 'cancel'))) cancel();
    }, 250);
    sent = true;
    const result = await Promise.race([
      client.request('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: prompt }] }, 0),
      cancelDeadline,
    ]);
    responseReceived = true;
    state.stopReason = result?.stopReason ?? null;
    state.denied = denied;
    if (state.stopReason === 'cancelled') state.status = 'cancelled';
    else if (state.stopReason === 'end_turn') state.status = denied ? 'permission-denied' : 'review-ready';
    else throw new Error(`ACP ended the turn with ${state.stopReason ?? 'no stop reason'}.`);
  } catch (error) {
    state.status = sent && !responseReceived ? 'cleanup-needed' : 'failed';
    state.error = error.message;
  } finally {
    clearInterval(cancelPoll);
    clearTimeout(cancelTimer);
    if (client) {
      if (session?.canClose && (!sent || responseReceived)) {
        try {
          await client.request('session/close', { sessionId: session.sessionId }, 5_000);
        } catch (error) {
          state.status = 'cleanup-needed';
          state.error ??= error.message;
        }
      }
      const exit = await client.shutdown();
      if (exit.code !== 0 && sent) {
        state.status = 'cleanup-needed';
        state.error ??= `ACP process exited (${exit.signal ?? exit.code}).`;
      }
    }
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    if (state.status !== 'cleanup-needed') {
      state.workerPid = null;
      state.runnerPid = null;
    }
    save(job, state);
    if (state.status !== 'cleanup-needed') unlock();
    emit(state.status, state);
    if (state.status !== 'review-ready') process.exitCode = 1;
  }
}

function processExists(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw new Error(`Could not verify process ${pid}: ${error.message}`);
  }
}

function discardJob(job, state, confirmedStopped) {
  if (existsSync(join(job, 'finalized.json'))) throw new Error('Retry finish to complete the approved cleanup.');
  const uncertain = ['cleanup-needed', 'starting', 'running'].includes(state.status);
  if (uncertain && (!confirmedStopped || (state.status !== 'cleanup-needed' && !state.runnerPid))) {
    throw new Error('Worker termination is unconfirmed. Inspect the job processes before cleanup.');
  }
  if (!uncertain && !['prepared', 'cancelled', 'failed', 'permission-denied'].includes(state.status)) {
    throw new Error(`Cannot discard in state ${state.status}.`);
  }
  for (const pid of [state.runnerPid, state.workerPid]) {
    if (processExists(pid)) throw new Error(`Process ${pid} is still running. Job was preserved.`);
  }

  let unlockWorkspace;
  try {
    if (lstatSync(state.cwd, { throwIfNoEntry: false })) {
      const workspace = workspaceFor(job, state);
      // An interrupted turn keeps its own lock until the job is removed.
      if (!uncertain || !existsSync(join(workspace.directory, 'operation.lock'))) {
        unlockWorkspace = lockWorkspace(workspace);
      }
    }
    const current = readJob(job).state;
    if (current.turn !== state.turn || current.status !== state.status) throw new Error('Job status changed. Inspect status and retry.');
    if (state.kind === 'git') removeGitWorkspace(job, state);
    rmSync(job, { recursive: true, force: true });
    return emit('discarded', { job, original: state.original });
  } finally {
    if (unlockWorkspace && existsSync(join(state.cwd, '..', 'operation.lock'))) unlockWorkspace();
  }
}

async function main([action, ...args]) {
  if (action === 'update') {
    if (args.length) throw new Error('Usage: update');
    return updateCli();
  }
  if (action === 'prepare') {
    const copy = args[0] === '--copy';
    const targets = copy ? args.slice(1) : args;
    if (targets.length > 1 || (copy && !targets.length)) throw new Error('Usage: prepare [--copy] [original-worktree]');
    return prepare(targets[0], copy);
  }
  if (action === 'capabilities') {
    if (args.length > 1) throw new Error('Usage: capabilities [absolute-workspace]');
    return capabilities(args[0]);
  }
  if (action === 'quota') {
    if (args.length) throw new Error('Usage: quota');
    return quota();
  }
  if (!['start', 'follow-up', 'status', 'cancel', 'review', 'finish', 'discard'].includes(action)) {
    throw new Error('Usage: update | capabilities | quota | prepare | start | follow-up | status | cancel | review | finish | discard');
  }
  const { job, state } = readJob(args[0]);
  if (action === 'start' || action === 'follow-up') {
    const { values } = parseArgs({
      args: args.slice(2), options: { edit: { type: 'boolean' }, model: { type: 'string' }, effort: { type: 'string' } },
    });
    return promptWorker(job, state, action, args[1], values);
  }
  if (action === 'finish') {
    if (args.length !== 3 || !['--apply', '--keep'].includes(args[2])) {
      throw new Error('Usage: finish job review-id (--apply | --keep). Ask the user after reviewing.');
    }
  } else if (action === 'discard') {
    if (args.length > 2 || (args.length === 2 && args[1] !== '--confirmed-stopped')) {
      throw new Error('Usage: discard job [--confirmed-stopped]');
    }
  } else if (args.length !== 1) throw new Error(`Usage: ${action} job`);
  if (action === 'status') return emit(state.status, state);
  if (action === 'cancel') {
    if (state.status !== 'running') throw new Error(`Cannot cancel in state ${state.status}.`);
    writeFileSync(join(state.turn, 'cancel'), '', { mode: 0o600 });
    return emit('cancellation-queued', { job, turn: state.turn });
  }

  const unlock = lockWorkspace({ directory: job });
  let unlockWorkspace;
  try {
    const current = readJob(job).state;
    if (current.turn !== state.turn || current.status !== state.status) throw new Error('Job status changed. Inspect status and retry.');
    if (action === 'discard') return discardJob(job, current, args[1] === '--confirmed-stopped');
    if (current.status !== 'review-ready' || current.workerPid) throw new Error('Finish the worker turn before reviewing or applying.');
    const finalized = existsSync(join(job, 'finalized.json'));
    const missing = !existsSync(state.cwd);
    const workspace = action === 'finish' && finalized && missing
      ? { cwd: state.cwd, original: state.original }
      : workspaceFor(job, state);
    if (!missing) unlockWorkspace = lockWorkspace(workspace);
    if (action === 'review') {
      if (finalized) throw new Error('Retry finish to complete the approved cleanup.');
      return emit('review', reviewResult(job, workspace, current));
    }
    const outcome = finalizeResult(job, workspace, current, args[1], args[2]);
    if (outcome.kept) return emit('kept', { job, cwd: outcome.kept, original: outcome.original });
    rmSync(job, { recursive: true, force: true });
    unlockWorkspace = null;
    emit('applied', { original: outcome.original });
  } finally {
    if (unlockWorkspace && existsSync(join(state.cwd, '..', 'operation.lock'))) unlockWorkspace();
    if (existsSync(join(job, 'operation.lock'))) unlock();
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  emit('error', { message: error.message });
  process.exitCode = 1;
}
