import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';
import { backupInstallFile, readInstallFile } from './install-file.mjs';

async function withConfigServer(run) {
  const stdio = ['pipe', 'pipe', 'ignore'];
  const child = process.platform === 'win32'
    ? spawn('codex app-server --listen stdio://', { shell: true, windowsHide: true, stdio })
    : spawn('codex', ['app-server', '--listen', 'stdio://'], { stdio });
  const closed = once(child, 'close').catch(() => undefined);
  child.stdin.on('error', () => {});
  const lines = createInterface({ input: child.stdout });
  const messages = lines[Symbol.asyncIterator]();
  const timer = setTimeout(() => child.kill(), 15_000);
  let nextId = 0;

  const send = message => child.stdin.write(JSON.stringify(message) + '\n');
  async function request(method, params) {
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

  try {
    await request('initialize', { clientInfo: { name: 'ai_setting', title: 'AI-Setting', version: '1' } });
    send({ method: 'initialized' });
    return await run(request);
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.end();
    child.kill();
    await closed;
  }
}

export async function syncCodexDirectoryPermission(path, directory, backupLabel, run = withConfigServer) {
  const original = readInstallFile(path);
  return run(async request => {
    const result = await request('config/read', { includeLayers: true });
    const user = result.layers?.find(layer => layer.name.type === 'user' && resolve(layer.name.file) === path);
    if (original && !user) throw new Error(`Codex가 읽은 사용자 설정 경로를 확인하세요 (${path}).`);
    const config = user?.config ?? {};
    if (config.default_permissions || ['read-only', 'danger-full-access'].includes(config.sandbox_mode)) {
      throw new Error(`쓰기 경로를 등록하려면 Codex workspace-write 설정을 확인하세요 (${path}).`);
    }
    const roots = config.sandbox_workspace_write?.writable_roots ?? [];
    if (roots.some(root => isAbsolute(root) && resolve(root) === directory)) return { path, added: false };

    const current = readInstallFile(path);
    if (original ? !current?.equals(original) : current) {
      throw new Error(`동기화 중 Codex 설정이 변경되었습니다 (${path}). 다시 실행하세요.`);
    }
    const backup = backupInstallFile(path, original, backupLabel);
    const written = await request('config/value/write', {
      keyPath: 'sandbox_workspace_write.writable_roots',
      value: [...roots, directory],
      mergeStrategy: 'replace',
      filePath: path,
      expectedVersion: user?.version,
    });
    if (written.status !== 'ok') throw new Error(`상위 Codex 설정이 쓰기 권한을 덮어씁니다 (${path}).`);
    return { path, added: true, backup };
  });
}
