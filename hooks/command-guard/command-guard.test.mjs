import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inspectCommand } from './command-guard.mjs';

const cwd = '/workspace/repo';

const cases = {
  deny: [
    'git push --force origin feature',
    'git push -uf origin feature',
    'git push --dry-run --no-dry-run --force origin feature',
    'git push origin +HEAD:develop',
    "git -C '/tmp/test repo' --no-pager push --mirror origin",
    '/usr/bin/git push origin :refs/heads/develop',
    'git push --repo=origin -d main',
    'git push origin -d feature master',
    'git commit --no-verify -m message',
    'git commit -anm message',
    'git commit -Ssigningkey -n -m message',
    'git push --no-verify origin feature',
    'git -c "core.hooksPath=/dev/null" commit',
    'git --config-env=core.hooksPath=HOOKS push origin feature',
    'git clean -fdx',
    'git clean -ffdx',
    'git -c clean.requireForce=false clean -dx',
    'git clean -fdx -e --dry-run',
    'rm -rf .',
    'sudo -u user /bin/rm -rf "$HOME"',
    'command rm --recursive /',
    'rm -rf -- ./*',
    'chmod -Rv 0777 ./tmp',
    'chmod --recursive a+rwx .',
    'git status; env GIT_TRACE=1 git push -f',
    'echo ok && (git push -f origin feature) >/dev/null',
    'git push \\\n  --force 2>/dev/null',
    "bash -lc 'git status && git push --force'",
    'git reset --hard; git push -f',
    "cat <<'EOF'\nordinary content\nEOF\ngit push -f",
    'git push --force-with-lease origin feature',
    'git push --force-with-lease=feature:abc origin feature',
    'git push origin :feature',
    'git push develop --delete feature',
    'git push origin --delete feature/topic',
    'git push origin :refs/tags/feature/topic',
    'git push origin :refs/heads/release/topic',
    'git push origin :refs/heads/feature/',
    'git push origin :refs/heads/feature/topic :refs/heads/main',
    'git push origin :refs/heads/feature/topic :',
    'git push origin -d refs/heads/feature/topic refs/heads/release/topic',
    'git push origin -d refs/heads/feature/$BRANCH',
    'git push $REMOTE :refs/heads/feature/topic',
    'git push origin --pru :refs/heads/feature/topic',
    'git push origin --force-with-l :refs/heads/feature/topic',
    'git push origin --no-verify :refs/heads/feature/topic',
    'git push origin --dry-run --no-dry -d refs/heads/main',
    ...['main', 'master', 'develop', 'test', 'prod'].map(branch => `git push origin --del refs/heads/${branch}`),
    'git push --prune origin',
    'git clean -fd -- tmp',
    'git reset --hard HEAD',
    'git --no-lazy-fetch reset --hard',
    'git --exec-path=/example/git-core reset --hard',
    'git restore --source=HEAD --staged --worktree .',
    'git restore -SW .',
    'git checkout .',
    'git checkout -- .',
    'git checkout HEAD .',
    'git branch -D feature',
    'git branch -df feature',
    'git worktree remove --force ./tmp',
    'git stash clear',
    'git stash drop stash@{0}',
    'rm -rf ./build-cache',
    'find ./tmp -type f -delete',
    "find ./tmp -name '-name' -delete",
    'rsync -av --delete-after ./src/ ./dst/',
    'rsync -av --del ./src/ ./dst/',
  ],
  allow: [
    'git status --short',
    'git --no-lazy-fetch status --short',
    'git --exec-path',
    'git push',
    'git push origin HEAD:develop',
    'git push origin :',
    'git push origin --delete refs/heads/feature/topic',
    'git push origin -d refs/heads/feature/a refs/heads/feature/team/b',
    'git push origin :refs/heads/feature/topic',
    'git push --push-o option origin :refs/heads/feature/topic',
    'git push origin --dry-run --delete refs/heads/prod',
    'git push -n --force origin feature',
    'git push -o --force origin feature',
    'git commit -m "--no-verify"',
    'git commit -mone',
    'git commit -Ssigningkey -uno -m message',
    'git clean -ndx',
    'git restore --staged .',
    'git restore -- src/file.js',
    'git checkout develop',
    'git checkout -- src/file.js',
    'git reset --soft HEAD~1',
    'git branch -d feature',
    'git worktree remove ./tmp',
    'rsync -avn --delete ./src/ ./dst/',
    "find ./tmp -name '-delete'",
    'rm ./tmp/report.txt',
    'chmod 777 ./tmp/report.txt',
    'chmod -R 755 ./tmp',
    'command -v git',
    "echo 'git push --force; rm -rf /'",
    "git status # git push --force",
    "cat <<'EOF'\ngit push --force\nrm -rf /\nEOF\npnpm test",
    "cat <<-'EOF'\n\tgit push --force\n\tEOF\nnode --version",
    'echo "--delete" | rg git',
  ],
};

for (const [decision, commands] of Object.entries(cases)) {
  for (const command of commands) {
    test(JSON.stringify(command) + ' → ' + decision, () => {
      assert.equal(inspectCommand(command, cwd, 'darwin').decision, decision);
    });
  }
}

test('워크스페이스 밖의 다른 Git 저장소 루트도 재귀 삭제를 차단한다', (t) => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'command-guard-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(path.join(fixture, '.git'));
  assert.equal(inspectCommand('rm -rf "' + fixture + '"', cwd).decision, 'deny');
});

test('Windows 실행 파일 경로와 PowerShell 재귀 삭제를 판별한다', () => {
  const inspect = (command) => inspectCommand(command, 'C:\\work\\repo', 'win32').decision;
  assert.equal(inspect('& "C:\\Program Files\\Git\\bin\\git.exe" push --force origin feature'), 'deny');
  assert.equal(inspect('& "C:\\Program Files\\Git\\bin\\git.exe" push origin --delete "refs/heads/feature/한글"'), 'allow');
  assert.equal(inspect('git push origin --delete refs/heads/prod'), 'deny');
  assert.equal(inspect('Remove-Item -LiteralPath C:\\work\\repo -Recurse -Force'), 'deny');
  assert.equal(inspect('Remove-Item -Recurse -Force .\\tmp'), 'deny');
  assert.equal(inspect('rmdir /s /q C:\\'), 'deny');
  assert.equal(inspect('Remove-Item -LiteralPath .\\tmp\\result.txt'), 'allow');
});

const clients = {
  codex: {
    script: fileURLToPath(new URL('./codex/codex-command-guard.mjs', import.meta.url)),
    event: command => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }),
    config: result => result.hooks.PreToolUse[0],
    matcher: '^Bash$',
    decision: result => result.hookSpecificOutput?.permissionDecision ?? 'allow',
    reason: result => result.hookSpecificOutput?.permissionDecisionReason,
  },
  antigravity: {
    script: fileURLToPath(new URL('./gemini/gemini-command-guard.mjs', import.meta.url)),
    event: CommandLine => ({ toolCall: { name: 'run_command', args: { CommandLine, Cwd: cwd } } }),
    config: result => result['ai-setting-command-guard'].PreToolUse[0],
    matcher: '^run_command$',
    decision: result => result.decision,
    reason: result => result.reason,
  },
};

test('Antigravity 명령에 Cwd가 없으면 워크스페이스 또는 실행 위치를 사용한다', () => {
  const client = clients.antigravity;
  for (const workspacePaths of [[cwd], []]) {
    const run = CommandLine => parseResult(spawnSync(process.execPath, [client.script], {
      input: JSON.stringify({ workspacePaths, toolCall: { name: 'run_command', args: { CommandLine } } }),
      encoding: 'utf8',
    }));
    assert.deepEqual(run('git --version'), { decision: 'allow' });
    assert.deepEqual(run('git -C /dev/null push --force'), inspectCommand('git -C /dev/null push --force', cwd));
    assert.equal(run('rm -rf ./tmp').decision, 'deny');
  }
});

function parseResult(run) {
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  return JSON.parse(run.stdout);
}

for (const [name, client] of Object.entries(clients)) {
  test(name + '의 허용·차단 응답과 입력 오류', () => {
    const run = input => parseResult(spawnSync(process.execPath, [client.script], { input, encoding: 'utf8' }));
    assert.equal(client.decision(run(JSON.stringify(client.event('git status')))), 'allow');
    assert.equal(client.decision(run(JSON.stringify(client.event('git push origin :refs/heads/feature/topic')))), 'allow');
    assert.equal(client.decision(run(JSON.stringify(client.event('git push origin :refs/heads/test')))), 'deny');
    assert.equal(client.decision(run(JSON.stringify(client.event('git checkout .')))), 'deny');
    const denied = run(JSON.stringify(client.event('git push -f https://example.invalid/PRIVATE feature')));
    assert.equal(client.decision(denied), 'deny');
    assert.doesNotMatch(JSON.stringify(denied), /PRIVATE|example\.invalid/);
    const command = 'git push --force-with-lease origin feature';
    const leaseDenied = run(JSON.stringify(client.event(command)));
    assert.equal(client.decision(leaseDenied), 'deny');
    assert.equal(client.reason(leaseDenied), inspectCommand(command, cwd).reason);
    assert.equal(client.decision(run('{"invalid":')), 'deny');
    assert.equal(client.decision(run(JSON.stringify(client.event(undefined)))), 'deny');
  });

  test(name + '의 복사 설치, --print-config 등록과 실행', (t) => {
    const installation = mkdtempSync(path.join(tmpdir(), "guard copy's "));
    t.after(() => rmSync(installation, { recursive: true, force: true }));
    const clientDir = path.basename(path.dirname(client.script));
    mkdirSync(path.join(installation, clientDir));
    const entry = path.join(installation, clientDir, path.basename(client.script));
    copyFileSync(client.script, entry);
    for (const file of ['command-guard.mjs', 'hook-cli.mjs', 'shell-commands.mjs']) {
      copyFileSync(new URL('./' + file, import.meta.url), path.join(installation, file));
    }
    const config = client.config(parseResult(spawnSync(process.execPath, [
      entry, '--print-config',
    ], { encoding: 'utf8' })));
    assert.equal(config.matcher, client.matcher);
    assert.equal(config.hooks[0].type, 'command');
    assert.equal(config.hooks[0].timeout, 5);
    if (process.platform === 'win32') return; // Antigravity의 실행기는 실제 호스트에서 확인한다.
    const result = parseResult(spawnSync('/bin/sh', ['-c', config.hooks[0].command], {
      input: JSON.stringify(client.event('git clean -fdx')),
      encoding: 'utf8',
    }));
    assert.equal(client.decision(result), 'deny');
  });
}
