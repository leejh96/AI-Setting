import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const runner = fileURLToPath(new URL('./lint.mjs', import.meta.url));
const eslintPlugin = pathToFileURL(createRequire(import.meta.url).resolve('typescript-eslint')).href;

function fixture(t, initialFiles) {
  const parent = mkdtempSync(join(tmpdir(), 'ai-setting-lint-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const project = join(parent, 'project with spaces');
  const write = (file, text) => {
    const path = join(project, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  for (const [file, text] of Object.entries(initialFiles)) write(file, text);
  const run = (...paths) => spawnSync(process.execPath, [runner, project, ...paths], {
    cwd: parent, encoding: 'utf8', windowsHide: true, timeout: 20_000,
  });
  return { parent, project, run, write };
}

const comparison = 'export function compare(value) { value++; return value == 2; }';
const tsconfig = '{"compilerOptions":{"target":"ES2022","strict":true},"include":["src"]}';

test('전역 규칙으로 검사하며 프로젝트에 설정이나 스크립트를 생성하지 않는다', t => {
  const f = fixture(t, { 'src/sample.js': comparison });
  writeFileSync(join(f.parent, 'eslint.config.mjs'), "export default [{ rules: { 'eqeqeq': 'off' } }];");
  const result = f.run('src/sample.js');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /eqeqeq/);
  assert.deepEqual(readdirSync(f.project), ['src']);
});

test('가까운 프로젝트 설정의 추가 규칙과 파일별 예외를 합성한다', t => {
  const f = fixture(t, {
    'src/sample.js': comparison,
    'packages/web/sample.js': comparison,
    'packages/web/ignored.js': comparison,
    'packages/web/eslint.config.mjs': `export default [
      { ignores: ['ignored.js'] },
      { files: ['sample.js'], rules: { eqeqeq: 'off', 'no-plusplus': 'error' } },
    ];`,
  });
  const result = f.run('src/sample.js', 'packages/web/sample.js', 'packages/web/ignored.js');
  assert.equal(result.status, 1, result.stderr);
  assert.equal((result.stdout.match(/\beqeqeq\b/g) ?? []).length, 1);
  assert.equal((result.stdout.match(/\bno-plusplus\b/g) ?? []).length, 1);
  assert.match(result.stdout, /ignored.js[\s\S]*File ignored/);
});

test('프로젝트 ESLint 설정 없이 타입 불일치와 처리되지 않은 Promise를 기본으로 검사한다', t => {
  const f = fixture(t, {
    'tsconfig.json': tsconfig,
    'src/service.ts': 'export async function save() { return 1; }',
    'src/bad.ts': `import { save } from './service';
export const value: number = 'text';
save();
void save();`,
    'src/good.ts': `import { save } from './service';
export async function run() { return await save(); }`,
  });
  const bad = f.run('src/bad.ts');
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stdout, /TS2322/);
  assert.equal((bad.stdout.match(/no-floating-promises/g) ?? []).length, 2);
  const good = f.run('src/good.ts');
  assert.equal(good.status, 0, good.stderr || good.stdout);
  assert.deepEqual(readdirSync(f.project).sort(), ['src', 'tsconfig.json']);
});

test('직접 지정한 프로젝트 tsconfig와 Promise 예외를 유지한다', t => {
  const f = fixture(t, {
    'tsconfig.json': '{"compilerOptions":{"target":"ES2022"},"include":["scripts"]}',
    'tsconfig.lint.json': tsconfig,
    'src/sample.ts': `export const value: number = 'text'; void Promise.resolve(1);`,
    'scripts/sample.ts': 'Promise.resolve(1);',
    'eslint.config.mjs': `export default [{
      files: ['src/**/*.ts'],
      languageOptions: { parserOptions: { project: './tsconfig.lint.json', tsconfigRootDir: import.meta.dirname } },
      rules: { '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }] },
    }];`,
  });
  const result = f.run('src/sample.ts', 'scripts/sample.ts');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /TS2322/);
  assert.equal((result.stdout.match(/no-floating-promises/g) ?? []).length, 1);
  assert.doesNotMatch(result.stdout, /Parsing error/);
});

test('프로젝트 참조의 하위 tsconfig로 타입 검사를 수행한다', t => {
  const f = fixture(t, {
    'tsconfig.json': '{"files":[],"references":[{"path":"./tsconfig.app.json"}]}',
    'tsconfig.app.json': tsconfig,
    'src/sample.ts': `export const value: number = 'text'; Promise.resolve(1);`,
  });
  const result = f.run('src/sample.ts');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /TS2322/);
  assert.match(result.stdout, /no-floating-promises/);
});

test('tsconfig가 없거나 파일이 포함되지 않으면 검사를 통과시키지 않는다', t => {
  const f = fixture(t, { 'scripts/sample.ts': 'Promise.resolve(1);', 'src/sample.ts': 'export const ok = true;' });
  const missing = f.run('scripts/sample.ts');
  assert.equal(missing.status, 2, missing.stderr || missing.stdout);
  assert.match(missing.stdout, /not found by the project service/);
  f.write('tsconfig.json', tsconfig);
  const excluded = f.run('scripts/sample.ts');
  assert.equal(excluded.status, 2, excluded.stderr || excluded.stdout);
  assert.match(excluded.stdout, /not found by the project service/);
  f.write('eslint.config.mjs', `export default [{ ignores: ['scripts/**'] }];`);
  const ignored = f.run('scripts/sample.ts');
  assert.equal(ignored.status, 0, ignored.stderr || ignored.stdout);
  assert.match(ignored.stdout, /File ignored/);
});

test('tsconfig가 타입 검사를 끈 경우 검사 불가로 보고한다', t => {
  const f = fixture(t, {
    'tsconfig.json': '{"compilerOptions":{"noCheck":true},"include":["src"]}',
    'src/sample.ts': `export const value: number = 'text';`,
  });
  const result = f.run('src/sample.ts');
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr, /noCheck가 타입 검사를 비활성화/);
});

test('프로젝트 TypeScript 플러그인이 있으면 그 인스턴스로 전역 규칙과 예외를 검사한다', t => {
  const f = fixture(t, {
    'tsconfig.json': tsconfig,
    'src/sample.ts': 'export function compare(value: any) { value++; return value == 2; }',
    'eslint.config.mjs': `import tseslint from ${JSON.stringify(eslintPlugin)};
      export default [{ files: ['src/**/*.ts'],
        plugins: { '@typescript-eslint': { ...tseslint.plugin } },
        rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-plusplus': 'error' },
      }];`,
  });
  const result = f.run('src/sample.ts');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /eqeqeq/);
  assert.match(result.stdout, /no-plusplus/);
  assert.doesNotMatch(result.stdout, /no-explicit-any/);
});

test('문법 및 설정 오류와 프로젝트 밖 파일은 실행 실패로 보고한다', t => {
  const f = fixture(t, { 'src/sample.js': 'export const = ;' });
  writeFileSync(join(f.parent, 'outside.js'), comparison);
  const outside = f.run('../outside.js');
  assert.equal(outside.status, 2);
  assert.match(outside.stderr, /프로젝트 안/);
  const invalid = f.run('src/sample.js');
  assert.equal(invalid.status, 2);
  assert.match(invalid.stdout, /Parsing error/);
  f.write('eslint.config.mjs', "throw new Error('invalid fixture config');");
  const config = f.run('src/sample.js');
  assert.equal(config.status, 2);
  assert.match(config.stderr, /invalid fixture config/);
});
