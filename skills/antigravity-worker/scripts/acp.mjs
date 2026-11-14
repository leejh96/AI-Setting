import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const version = 1;
export const defaultModel = 'gemini-4-hydrogen';
export const defaultEffort = 'high';

export function connect(agy, cwd, profile, serverLog, stderrLog, onUpdate) {
  const stderr = openSync(stderrLog, 'wx', 0o600);
  let child;
  try {
    child = spawn(agy, ['acp', '--sandbox', '--gemini-dir', profile, '--log-file', serverLog], {
      cwd, stdio: ['pipe', 'pipe', stderr], windowsHide: true,
    });
  } finally {
    closeSync(stderr);
  }
  let nextId = 0;
  let failure;
  const pending = new Map();
  const commands = new Map();
  const commandUpdates = new EventEmitter();
  const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));

  function fail(error) {
    failure ??= error;
    for (const { reject } of pending.values()) reject(failure);
    pending.clear();
  }

  child.once('error', fail);
  child.stdin.on('error', fail);
  child.stdout.on('error', fail);
  child.once('close', (code, signal) => fail(new Error(`ACP process exited (${signal ?? code}).`)));

  function send(message) {
    if (failure) throw failure;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  }

  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
    try {
      const message = JSON.parse(line);
      if (message.method && 'id' in message) {
        if (message.method === 'session/request_permission') {
          onUpdate(message.params?.sessionId, { sessionUpdate: 'permission_denied', title: message.params?.toolCall?.title });
          send({ id: message.id, result: { outcome: { outcome: 'cancelled' } } });
        } else {
          send({ id: message.id, error: { code: -32601, message: 'Client capability unavailable' } });
        }
      } else if (message.method === 'session/update') {
        const { sessionId, update } = message.params;
        if (update.sessionUpdate === 'available_commands_update' && Array.isArray(update.availableCommands)) {
          commands.set(sessionId, update.availableCommands);
          commandUpdates.emit(sessionId);
        }
        onUpdate(sessionId, update);
      } else {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
        else request.resolve(message.result);
      }
    } catch (error) {
      fail(error);
    }
  });

  function request(method, params, timeout = 60_000) {
    const id = ++nextId;
    const { promise, resolve, reject } = Promise.withResolvers();
    pending.set(id, { method, resolve, reject });
    return (async () => {
      const timer = timeout && setTimeout(() => reject(new Error(`${method}: response timed out.`)), timeout);
      try {
        send({ id, method, params });
        return await promise;
      } finally {
        clearTimeout(timer);
        pending.delete(id);
      }
    })();
  }

  async function shutdown() {
    child.stdin.end();
    const result = await Promise.race([exited, delay(5_000, null, { ref: false })]);
    if (result) return result;
    child.kill('SIGTERM');
    const terminated = await Promise.race([exited, delay(5_000, null, { ref: false })]);
    if (terminated) return terminated;
    child.kill('SIGKILL');
    return await exited;
  }

  return {
    pid: child.pid,
    request,
    cancel: sessionId => send({ method: 'session/cancel', params: { sessionId } }),
    commandsFor: sessionId => commands.get(sessionId) ?? null,
    async listCommands(sessionId) {
      if (!commands.has(sessionId)) {
        const signal = AbortSignal.timeout(5_000);
        try {
          await once(commandUpdates, sessionId, { signal });
        } catch (error) {
          if (!signal.aborted) throw error;
        }
      }
      return commands.get(sessionId) ?? null;
    },
    shutdown,
  };
}

export async function openSession(client, cwd, previous) {
  const init = await client.request('initialize', { protocolVersion: version, clientCapabilities: {} });
  if (init.protocolVersion !== version) throw new Error(`Unsupported ACP version: ${init.protocolVersion}`);
  const capabilities = init.agentCapabilities?.sessionCapabilities ?? {};
  const params = { cwd, mcpServers: [] };
  if (previous && !capabilities.resume) throw new Error('This agy version does not advertise session/resume.');
  const session = previous
    ? await client.request('session/resume', { ...params, sessionId: previous })
    : await client.request('session/new', params);
  const sessionId = previous ?? session.sessionId;
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('ACP did not return a session ID.');
  return {
    sessionId, agent: init.agentInfo, options: session.configOptions, canClose: Boolean(capabilities.close),
    availableModels: session.models?.availableModels,
  };
}

export async function configureSession(client, session, requested) {
  const { sessionId } = session;
  for (const [configId, value] of Object.entries(requested)) {
    const option = session.options?.find(option => option.id === configId);
    if (option?.currentValue === value) continue;
    const choices = option?.options?.flatMap(choice => choice.options ?? [choice]) ?? [];
    if (!choices.some(choice => choice.value === value)) {
      const allowed = choices.map(choice => choice.value).join(', ');
      throw new Error(allowed ? `Unsupported ${configId}=${value}. Available: ${allowed}.`
        : `The selected ACP model or session does not offer ${configId}.`);
    }
    ({ configOptions: session.options } = await client.request('session/set_config_option', { sessionId, configId, value }));
  }
  for (const [id, value] of Object.entries(requested)) {
    if (session.options?.find(option => option.id === id)?.currentValue !== value) {
      throw new Error(`ACP did not apply session setting ${id}=${value}.`);
    }
  }
}
