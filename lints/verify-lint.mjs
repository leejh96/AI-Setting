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

test('전역 TypeScript 플러그인으로 프로젝트에서 선택한 파일에 타입 기반 규칙을 더한다', t => {
  const promise = 'Promise.resolve(1);';
  const f = fixture(t, {
    'tsconfig.json': '{"compilerOptions":{"target":"ES2022"},"include":["src"]}',
    'src/sample.ts': promise,
    'scripts/sample.ts': promise,
    'eslint.config.mjs': `export default [{
      files: ['src/**/*.ts'],
      languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
      rules: { '@typescript-eslint/no-floating-promises': 'error' },
    }];`,
  });
  const result = f.run('src/sample.ts', 'scripts/sample.ts');
  assert.equal(result.status, 1, result.stderr);
  assert.equal((result.stdout.match(/no-floating-promises/g) ?? []).length, 1);
  assert.doesNotMatch(result.stdout, /Parsing error/);
});

test('프로젝트 TypeScript 플러그인이 있으면 그 인스턴스로 전역 규칙과 예외를 검사한다', t => {
  const f = fixture(t, {
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
