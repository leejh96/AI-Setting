import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { checkLintRuntime } from './check-install-runtime.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const checker = join(repo, 'scripts', 'check-install.mjs');
const lintFiles = ['eslint.config.mjs', 'lint.mjs', 'package.json', 'package-lock.json'];

test('Git 설치 점검은 다른 작업 트리의 설정을 배제하고 현재 저장소의 로컬 설정을 확인한다', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'ai-setting-check-git-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const current = join(fixture, 'current');
  const other = join(fixture, 'other');
  const install = join(fixture, 'installed-hook');
  const scanner = join(fixture, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
  const env = { ...cleanEnv, GIT_CONFIG_GLOBAL: join(fixture, 'gitconfig'), AI_SETTING_GITLEAKS_BIN: scanner };
  const run = (command, args, vars = env) => spawnSync(command, args, { env: vars, encoding: 'utf8', timeout: 10_000, windowsHide: true });
  const git = (...args) => {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr);
  };
  for (const dir of [current, other]) {
    mkdirSync(dir);
    git('-C', dir, 'init', '--quiet');
  }
  for (const path of ['scripts/check-install.mjs', 'scripts/check-install-runtime.mjs',
    'hooks/command-guard/shell-commands.mjs', 'hooks/code-quality-review/review-request.mjs', 'hooks/commit-secret-checker']) {
    const destination = join(current, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(repo, path), destination, { recursive: true });
  }
  cpSync(join(repo, 'hooks', 'commit-secret-checker'), install, { recursive: true });
  writeFileSync(scanner, '', { mode: 0o700 });
  git('config', '--global', 'core.hooksPath', install);
  git('-C', other, 'config', '--local', 'core.hooksPath', join(other, 'other-hooks'));
  const polluted = { ...env, GIT_DIR: join(other, '.git'), GIT_WORK_TREE: other };
  const check = () => run(process.execPath, [join(current, 'scripts/check-install.mjs'), 'git'], polluted);
  assert.equal(check().status, 0);
  git('-C', current, 'config', '--local', 'core.hooksPath', join(current, 'local-hooks'));
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /확인 필요 {2}Git 이 저장소의 pre-commit 경로/);
});

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
  assert.ok(healthy.stdout.includes(`일치  Antigravity ${join('skills', 'task-lessons')}`));
  assert.match(healthy.stdout, /Antigravity rules\/code-quality-review\.md/);
  assert.match(healthy.stdout, /Git 전역 pre-commit/);
  assert.doesNotMatch(healthy.stdout, /규칙 위반 TS|읽기·쓰기·삭제/);

  const artifacts = join(codex, 'skills', 'compare-changes', 'artifacts');
  const lessons = join(home, 'custom-lessons');
  env.CODEX_LESSONS_DIR = lessons;
  for (const directory of [artifacts, lessons]) {
    mkdirSync(directory);
    writeFileSync(join(directory, 'keep.md'), 'previous contents');
  }
  // The fixture intentionally has no lint dependencies.
  const runtime = scan('--runtime', 'codex');
  assert.equal(runtime.status, 1, runtime.stdout);
  assert.match(runtime.stdout, /확인 필요 {2}Codex 전역 린트 실행/);
  assert.match(runtime.stdout, /일치 {2}Codex compare-changes\/artifacts 읽기·쓰기·삭제/);
  assert.match(runtime.stdout, /일치 {2}Codex task-lessons 교훈 폴더 읽기·쓰기·삭제/);
  assert.doesNotMatch(runtime.stdout, /Antigravity|Git 전역/);
  for (const directory of [artifacts, lessons]) {
    assert.deepEqual(readdirSync(directory), ['keep.md']);
    assert.equal(readFileSync(join(directory, 'keep.md'), 'utf8'), 'previous contents');
  }
  env.CODEX_LESSONS_DIR = 'relative-storage';
  const missing = scan('--runtime');
  assert.equal(missing.status, 1, missing.stdout);
  assert.match(missing.stdout, /저장 폴더에 절대 경로가 필요함/);
  assert.match(missing.stdout, /확인 필요 {2}Antigravity compare-changes\/artifacts 읽기·쓰기·삭제\r?\n {2}- 파일 생성 실패 \(ENOENT\)/);
  assert.equal(existsSync(join(gemini, 'skills', 'compare-changes', 'artifacts')), false);
  const antigravityLessons = join(gemini, 'skills', 'task-lessons', 'lessons');
  assert.match(missing.stdout, /확인 필요 {2}Antigravity task-lessons 교훈 폴더 읽기·쓰기·삭제\r?\n {2}- 파일 생성 실패 \(ENOENT\)/);
  assert.equal(existsSync(antigravityLessons), false);
  mkdirSync(antigravityLessons);
  const antigravityRuntime = scan('antigravity', '--runtime');
  assert.match(antigravityRuntime.stdout, /일치 {2}Antigravity task-lessons 교훈 폴더 읽기·쓰기·삭제/);
  assert.doesNotMatch(antigravityRuntime.stdout, /Codex|절대 경로가 필요함/);
  assert.deepEqual(readdirSync(antigravityLessons), []);
  assert.equal(scan('git', '--runtime').status, 0);
  assert.equal(scan('--runtime', '--runtime').status, 2);

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

test('런타임 린트 점검은 두 예제의 종료 코드와 실제 규칙 진단을 대조하고 임시 폴더를 정리한다', t => {
  const home = mkdtempSync(join(tmpdir(), 'check-install-runtime-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const runner = join(home, 'lint.mjs');
  const trace = join(home, 'fixture-project');
  const runWith = behavior => {
    writeFileSync(runner, `
      import { readFileSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      const [project, file] = process.argv.slice(2);
      writeFileSync(${JSON.stringify(trace)}, project);
      const config = JSON.parse(readFileSync(join(project, 'tsconfig.json'), 'utf8'));
      const source = readFileSync(join(project, file), 'utf8');
      if (!config.files.includes('floating.ts') || !source.includes('Promise.resolve')) process.exit(2);
      ${behavior}
    `);
    const problems = checkLintRuntime(runner);
    assert.equal(existsSync(readFileSync(trace, 'utf8')), false);
    return problems;
  };
  assert.deepEqual(runWith(`if (file.endsWith('.ts')) {
    console.log('1:1  error  Promise must be handled  @typescript-eslint/no-floating-promises');
    process.exitCode = 1;
  }`), []);
  assert.match(runWith('').join('\n'), /TypeScript 위반 예제 종료 코드 0/);
  const errors = runWith("console.log('fixture-private-error'); process.exitCode = 1;").join('\n');
  assert.match(errors, /JavaScript 정상 예제 종료 코드 1/);
  assert.match(errors, /no-floating-promises 진단 누락/);
  assert.doesNotMatch(errors, /fixture-private-error/);
});
