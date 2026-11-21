import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { isAbsolute } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { backupInstallFile, readInstallFile, sameInstallPath } from './install-file.mjs';

const serverArgs = ['app-server', '--listen', 'stdio://'];

function openConfigServer() {
  const windows = process.platform === 'win32';
  const options = { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true };
  // Resolve the Windows command through PATH even when the installation uses an npm .cmd launcher.
  const child = windows ? spawn('codex ' + serverArgs.join(' '), { ...options, shell: true })
    : spawn('codex', serverArgs, options);
  return { child, shell: windows };
}

async function stopConfigServer(child, shell) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (shell && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    const completed = await Promise.race([
      once(killer, 'exit').catch(() => undefined),
      delay(1_000, undefined, { ref: false }),
    ]);
    killer.unref();
    if (completed?.[0] === 0) return;
  }
  child.kill('SIGKILL');
}

export async function withConfigServer(run, { open = openConfigServer, timeoutMs = 15_000 } = {}) {
  const { child, shell } = open();
  const closed = once(child, 'close').catch(() => undefined);
  const failed = new Promise((_, reject) => child.once('error', error => {
    reject(new Error('Codex 설정 서버를 실행할 수 없습니다.', { cause: error }));
  }));
  child.stdin.on('error', () => {});
  const lines = createInterface({ input: child.stdout });
  const messages = lines[Symbol.asyncIterator]();
  let timer;
  let timedOut = false;
  let pendingMethod;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`Codex 설정 서버 응답 시간이 초과되었습니다 (${pendingMethod}).`));
    }, timeoutMs);
  });
  let nextId = 0;

  function send(message) {
    if (timedOut) throw new Error('Codex 설정 서버 요청이 이미 종료되었습니다.');
    child.stdin.write(JSON.stringify(message) + '\n');
  }
  async function request(method, params) {
    pendingMethod = method;
    const id = nextId++;
    send({ id, method, params });
    while (true) {
      const line = await messages.next();
      if (line.done) throw new Error(`Codex 설정 서버가 응답하지 않았습니다 (${method}). Codex CLI 설치를 확인하세요.`);
      let message;
      try {
        message = JSON.parse(line.value);
      } catch {
        throw new Error(`Codex 설정 서버의 응답 형식이 올바르지 않습니다 (${method}).`);
      }
      if (message.id !== id) continue;
      if (message.error) throw new Error(`Codex 설정 요청에 실패했습니다 (${method}, ${message.error.code}).`);
      return message.result;
    }
  }

  async function exchange() {
    await request('initialize', { clientInfo: { name: 'ai_setting', title: 'AI-Setting', version: '1' } });
    send({ method: 'initialized' });
    return run(request);
  }

  try {
    return await Promise.race([exchange(), deadline, failed]);
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.end();
    try {
      await stopConfigServer(child, shell);
    } finally {
      child.stdin.destroy();
      child.stdout.destroy();
      await Promise.race([closed, delay(1_000, undefined, { ref: false })]);
      child.unref();
    }
  }
}

export async function syncCodexDirectoryPermission(path, directory, backupLabel, run = withConfigServer) {
  const original = readInstallFile(path);
  return run(async request => {
    const result = await request('config/read', { includeLayers: true });
    const user = result.layers?.find(layer => layer.name.type === 'user' && sameInstallPath(layer.name.file, path));
    if (original && !user) throw new Error(`Codex가 읽은 사용자 설정 경로를 확인하세요 (${path}).`);
    const config = user?.config ?? {};
    const effective = result.config ?? config;
    if (!config.default_permissions && !effective.default_permissions && effective.sandbox_mode === 'danger-full-access') {
      return { path, added: false };
    }
    if (config.default_permissions || effective.default_permissions || effective.sandbox_mode === 'read-only'
      || config.sandbox_mode === 'read-only' || config.sandbox_mode === 'danger-full-access') {
      throw new Error(`쓰기 경로를 등록하려면 Codex workspace-write 설정을 확인하세요 (${path}).`);
    }
    const roots = config.sandbox_workspace_write?.writable_roots ?? [];
    const effectiveRoots = effective.sandbox_workspace_write?.writable_roots ?? [];
    const matchesDirectory = root => isAbsolute(root) && sameInstallPath(root, directory);
    const overridden = `상위 Codex 설정이 쓰기 권한을 덮어씁니다 (${path}).`;
    if (effectiveRoots.some(matchesDirectory)) return { path, added: false };
    if (roots.some(matchesDirectory)) throw new Error(overridden);

    const current = readInstallFile(path);
    if (original ? !current?.equals(original) : current) {
      throw new Error(`동기화 중 Codex 설정이 변경되었습니다 (${path}). 다시 실행하세요.`);
    }
    const backup = backupInstallFile(path, original, backupLabel);
    const written = await request('config/value/write', {
      keyPath: 'sandbox_workspace_write.writable_roots',
      value: [...roots, directory],
      mergeStrategy: 'replace',
      filePath: user?.name.file ?? path,
      expectedVersion: user?.version,
    });
    if (written.status !== 'ok') throw new Error(overridden);
    return { path, added: true, backup };
  });
}
