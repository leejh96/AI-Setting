import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const checker = join(repo, 'scripts', 'check-install.mjs');
const lintFiles = ['eslint.config.mjs', 'lint.mjs', 'package.json', 'package-lock.json'];

test('설치 점검은 생성된 등록을 읽고 복사본 차이와 설정 오류를 구분한다', t => {
  const home = mkdtempSync(join(tmpdir(), "ai-setting 설치 O’Connor's "));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const codex = join(home, 'codex home');
  const gemini = join(home, '.gemini', 'config');
  const codexLint = join(codex, 'lints');
  const antigravityLint = join(home, '.gemini', 'lints');
  const commit = join(home, 'commit hook');
  const scanner = join(home, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
  writeFileSync(scanner, '', { mode: 0o700 });
  const env = {
    ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: codex, AI_SETTING_GITLEAKS_BIN: scanner,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: commit,
  };
  const run = (file, args) => spawnSync(file, args, { env, encoding: 'utf8', timeout: 10000, windowsHide: true });
  const scan = (...args) => run(process.execPath, [checker, ...args]);
  const git = run('git', ['config', '--global', 'core.hooksPath', commit]);
  assert.equal(git.status, 0, git.stderr);
  cpSync(join(repo, 'hooks', 'commit-secret-checker'), commit, { recursive: true });
  for (const destination of [codexLint, antigravityLint]) {
    mkdirSync(destination, { recursive: true });
    for (const file of lintFiles) cpSync(join(repo, 'lints', file), join(destination, file));
  }

  for (const [base, adapter, guide] of [[codex, 'codex', join(codex, 'AGENTS.md')],
    [gemini, 'gemini', join(home, '.gemini', 'GEMINI.md')]]) {
    mkdirSync(base, { recursive: true });
    cpSync(join(repo, 'global', 'AGENTS.md'), guide);
    cpSync(join(repo, 'skills'), join(base, 'skills'), { recursive: true });
    const config = adapter === 'codex' ? { hooks: {} } : {};
    for (const [folder, entry] of [['prompt-secret-checker', 'secret-checker'],
      ['code-quality-review', 'code-quality-review'], ['command-guard', 'command-guard']]) {
      const destination = join(base, 'hooks', folder);
      cpSync(join(repo, 'hooks', folder), destination, { recursive: true });
      if (adapter === 'gemini' && folder === 'code-quality-review') {
        rmSync(join(destination, 'REVIEW.md'));
        const ruleResult = run(process.execPath, [
          join(repo, 'hooks', folder, adapter, `${adapter}-${entry}.mjs`),
          '--write-rule', join(base, 'rules', 'code-quality-review.md'),
        ]);
        assert.equal(ruleResult.status, 0, ruleResult.stderr);
      }
      const result = run(process.execPath, [join(destination, adapter, `${adapter}-${entry}.mjs`), '--print-config']);
      assert.equal(result.status, 0, result.stderr);
      const generated = JSON.parse(result.stdout);
      if (adapter === 'codex') {
        for (const [event, groups] of Object.entries(generated.hooks)) (config.hooks[event] ??= []).push(...groups);
      } else Object.assign(config, generated);
    }
    writeFileSync(join(base, 'hooks.json'), JSON.stringify(config));
  }

  const healthy = scan();
  assert.equal(healthy.status, 0, healthy.stdout + healthy.stderr);
  for (const file of lintFiles) {
    assert.ok(healthy.stdout.includes(`일치  Codex 전역 린트 ${file}`));
    assert.ok(healthy.stdout.includes(`일치  Antigravity 전역 린트 ${file}`));
  }
  assert.match(healthy.stdout, /Antigravity 훅 신뢰/);
  assert.match(healthy.stdout, /Antigravity rules\/code-quality-review\.md/);
  assert.match(healthy.stdout, /Git 전역 pre-commit/);

  writeFileSync(join(codexLint, 'eslint.config.mjs'), 'different config');
  rmSync(join(antigravityLint, 'lint.mjs'));
  const lintDrift = scan();
  assert.equal(lintDrift.status, 1, lintDrift.stdout);
  assert.match(lintDrift.stdout, /확인 필요 {2}Codex 전역 린트 eslint\.config\.mjs\r?\n {2}- eslint\.config\.mjs 내용 불일치/);
  assert.match(lintDrift.stdout, /확인 필요 {2}Antigravity 전역 린트 lint\.mjs\r?\n {2}- lint\.mjs 누락/);
  cpSync(join(repo, 'lints', 'eslint.config.mjs'), join(codexLint, 'eslint.config.mjs'));
  cpSync(join(repo, 'lints', 'lint.mjs'), join(antigravityLint, 'lint.mjs'));

  const geminiRulePath = join(gemini, 'rules', 'code-quality-review.md');
  writeFileSync(geminiRulePath, '---\ntrigger: always_on\ndescription: "wrong"\n---\n\nchanged body\n');
  const ruleDrift = scan('antigravity');
  assert.equal(ruleDrift.status, 1, ruleDrift.stdout);
  assert.match(ruleDrift.stdout, /frontmatter\(trigger: model_decision, description\) 누락 또는 불일치/);
  assert.match(ruleDrift.stdout, /code-quality-review\.md 본문 내용 불일치/);
  assert.doesNotMatch(ruleDrift.stdout, /Codex|Git 전역/);

  rmSync(geminiRulePath);
  const missingRule = scan('antigravity');
  assert.equal(missingRule.status, 1, missingRule.stdout);
  assert.match(missingRule.stdout, /code-quality-review\.md 누락/);

  const codexConfig = join(codex, 'hooks.json');
  const config = JSON.parse(readFileSync(codexConfig, 'utf8'));
  const guard = config.hooks.PreToolUse[0];
  guard.matcher = '^OtherTool$';
  guard.hooks[0].enabled = false;
  config.hooks.PreToolUse.push(guard);
  delete config.hooks.Stop;
  writeFileSync(codexConfig, JSON.stringify(config));
  writeFileSync(join(codex, 'hooks', 'command-guard', 'command-guard.mjs'), 'fixture difference');
  const drift = scan('codex');
  assert.equal(drift.status, 1, drift.stdout);
  assert.match(drift.stdout, /내용 불일치/);
  assert.match(drift.stdout, /중복 등록/);
  assert.match(drift.stdout, /비활성화/);
  assert.match(drift.stdout, /matcher 불일치/);
  assert.match(drift.stdout, /등록 누락/);
  assert.doesNotMatch(drift.stdout, /Antigravity|Git 전역/);

  writeFileSync(codexConfig, '{ invalid fixture private value');
  const invalid = scan('codex');
  assert.equal(invalid.status, 1);
  assert.match(invalid.stdout, /등록 파일을 읽거나 해석할 수 없음/);
  assert.doesNotMatch(invalid.stdout + invalid.stderr, /private value/);
  assert.equal(scan('unknown').status, 2);
});
