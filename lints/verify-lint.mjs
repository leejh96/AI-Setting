import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const runner = fileURLToPath(new URL('./lint.mjs', import.meta.url));
const require = createRequire(import.meta.url);
const eslintPlugin = pathToFileURL(require.resolve('typescript-eslint')).href;
const eslint = pathToFileURL(require.resolve('eslint')).href;

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

test('별도 설정 없이 모든 JS 확장자에서 처리되지 않은 Promise를 검사한다', t => {
  const f = fixture(t, {
    'local.js': `async function save() { throw new Error('failed'); } save();`,
    'service.mjs': 'export async function save() { return 1; }',
    'consumer.mjs': `import { save } from './service.mjs'; save();`,
    'service.cjs': 'module.exports.save = async () => 1;',
    'consumer.cjs': `const { save } = require('./service.cjs'); save();`,
    'view.jsx': `export function View() { void Promise.resolve(1); return <div />; }`,
    'handled.js': `/** @type {number} */ export const value = 'text';
export async function run() { await Promise.resolve(1); }`,
  });
  const bad = f.run('local.js', 'consumer.mjs', 'consumer.cjs', 'view.jsx');
  assert.equal(bad.status, 1, bad.stderr || bad.stdout);
  assert.equal((bad.stdout.match(/no-floating-promises/g) ?? []).length, 4);
  assert.doesNotMatch(bad.stdout, /Parsing error|no-undef/);
  const good = f.run('handled.js');
  assert.equal(good.status, 0, good.stderr || good.stdout);
});

test('JS에서 프로젝트별 Promise 예외와 JS 문법 검사를 유지한다', t => {
  const f = fixture(t, {
    'eslint.config.mjs': `export default [{
      files: ['allowed.js'], rules: { '@typescript-eslint/no-floating-promises': 'off' },
    }];`,
    'allowed.js': 'Promise.resolve(1);',
    'invalid.js': 'export const value: number = 1;',
  });
  const allowed = f.run('allowed.js');
  assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
  const invalid = f.run('invalid.js');
  assert.equal(invalid.status, 2, invalid.stderr || invalid.stdout);
  assert.match(invalid.stdout, /Parsing error/);
});

test('JS Promise 검사를 하면서 ESLint 전역 변수와 ECMAScript 버전 설정을 적용한다', t => {
  const f = fixture(t, {
    'eslint.config.mjs': `export default [
      { files: ['restricted.js'], languageOptions: { globals: { SharedArrayBuffer: 'off' } } },
      { files: ['old.js'], languageOptions: { ecmaVersion: 5, sourceType: 'script' } },
    ];`,
    'restricted.js': 'export const make = () => new SharedArrayBuffer(8);',
    'old.js': 'new Map(); new WeakRef({});',
    'promise.js': 'Promise.resolve(1);',
  });
  const result = f.run('restricted.js', 'old.js', 'promise.js');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  for (const name of ['SharedArrayBuffer', 'Map', 'WeakRef']) {
    assert.match(result.stdout, new RegExp(`'${name}' is not defined.*no-undef`));
  }
  assert.match(result.stdout, /no-floating-promises/);
});

test('ES5에서 var를 허용하고 타입 파서가 읽지 못한 문법에도 기본 린트 결과를 출력한다', t => {
  const f = fixture(t, {
    'eslint.config.mjs': `import tseslint from ${JSON.stringify(eslintPlugin)};
      export default [{
        languageOptions: { ecmaVersion: 5, sourceType: 'script' },
        plugins: { '@typescript-eslint': tseslint.plugin },
        rules: { '@typescript-eslint/await-thenable': 'error' },
      }];`,
    'allowed.js': 'var answer = 42; String(answer);',
    'octal.js': 'String(010);',
    'inline.js': '/* eslint "@typescript-eslint/no-misused-promises": "error" */\nString(010);',
  });
  const allowed = f.run('allowed.js');
  assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
  const octal = f.run('octal.js', 'inline.js');
  assert.equal(octal.status, 2, octal.stderr || octal.stdout);
  assert.match(octal.stderr, /JavaScript Promise 검사 실패.*Octal literals/);
  assert.equal((octal.stdout.match(/no-octal/g) ?? []).length, 2, octal.stdout);
  assert.doesNotMatch(octal.stderr, /ESLint 실행 실패/);
});

test('프로젝트가 기본 JS 파서를 명시해도 정상 파일과 Promise 위반을 구별한다', t => {
  const f = fixture(t, {
    'eslint.config.mjs': `import { ESLint } from ${JSON.stringify(eslint)};
      const { languageOptions } = await new ESLint({ overrideConfigFile: true }).calculateConfigForFile('sample.js');
      export default [{ languageOptions: { parser: languageOptions.parser } }];`,
    'good.js': 'export const value = 1;',
    'bad.js': 'Promise.resolve(1);',
  });
  const good = f.run('good.js');
  assert.equal(good.status, 0, good.stderr || good.stdout);
  const bad = f.run('bad.js');
  assert.equal(bad.status, 1, bad.stderr || bad.stdout);
  assert.match(bad.stdout, /no-floating-promises/);
});

test('JS를 포함하는 참조 tsconfig와 가까운 jsconfig에서 각각 경로 별칭을 해석한다', t => {
  const settings = {
    compilerOptions: { target: 'ES2022', module: 'Preserve', paths: { '@api': ['./src/service.js'] } },
    include: ['src'],
  };
  const f = fixture(t, {
    'tsconfig.json': '{"files":[],"references":[{"path":"./app/tsconfig.app.json"}]}',
    'app/tsconfig.app.json': JSON.stringify({ ...settings, compilerOptions: {
      ...settings.compilerOptions, allowJs: true, composite: true,
    } }),
    'app/src/service.js': 'export async function save() { return 1; }',
    'app/src/alias.js': `import { save } from '@api'; save();`,
    'app/src/relative.js': `import { save } from './service.js'; save();`,
    'web/jsconfig.json': JSON.stringify(settings),
    'web/src/service.js': `export async function save() { return 'saved'; }`,
    'web/src/alias.js': `import { save } from '@api'; save();`,
    'app/scripts/standalone.js': 'Promise.resolve(1);',
  });
  const result = f.run('app/src/alias.js', 'web/src/alias.js', 'app/src/relative.js', 'app/scripts/standalone.js');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal((result.stdout.match(/no-floating-promises/g) ?? []).length, 4);
  for (const file of ['app/src/alias.js', 'app/src/relative.js', 'web/src/alias.js', 'app/scripts/standalone.js']) {
    assert.ok(result.stdout.replaceAll('\\', '/').includes(file), result.stdout);
  }
});

test('JS에서 프로젝트가 지정한 타입 설정으로 가져온 Promise를 검사한다', t => {
  const f = fixture(t, {
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        allowJs: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
        paths: { '@app/*': ['./src/*'] },
      },
      include: ['src'],
    }),
    'eslint.config.mjs': `export default [{
      files: ['src/**/*.js'],
      languageOptions: { parserOptions: { project: true, tsconfigRootDir: import.meta.dirname } },
    }];`,
    'src/service.js': 'export async function save() { return 1; }',
    'src/sample.js': `import { save } from '@app/service.js'; save();`,
  });
  const result = f.run('src/sample.js');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /no-floating-promises/);
});

test('하위 ESLint의 상대 프로젝트 경로와 명시한 기준 디렉터리를 각각 사용한다', t => {
  const f = fixture(t, {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { allowJs: true, noEmit: true, target: 'ES2022' },
      include: ['packages/web/explicit.js', 'packages/tools/src'],
    }),
    'packages/web/eslint.config.mjs': `import { resolve } from 'node:path';
      export default [
        { files: ['*.js'], languageOptions: { parserOptions: { project: './tsconfig.json' } } },
        { files: ['explicit.js'], languageOptions: { parserOptions: { tsconfigRootDir: resolve(import.meta.dirname, '../..') } } },
      ];`,
    'packages/web/tsconfig.json': JSON.stringify({
      compilerOptions: { allowJs: true, target: 'ES2022' }, include: ['sample.js'],
    }),
    'packages/web/sample.js': 'Promise.resolve(1);',
    'packages/web/explicit.js': 'Promise.resolve(1);',
    'packages/tools/eslint.config.mjs': 'export default [{}];',
    'packages/tools/src/sample.ts': `export const value: number = 'text';`,
  });
  const result = f.run('packages/web/sample.js', 'packages/web/explicit.js', 'packages/tools/src/sample.ts');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal((result.stdout.match(/no-floating-promises/g) ?? []).length, 2);
  assert.match(result.stdout, /TS2322/);
});

test('하위 ESLint가 자동 탐색을 지정해도 상위 tsconfig를 사용한다', t => {
  const f = fixture(t, {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { allowJs: true, noEmit: true, target: 'ES2022' }, include: ['packages'],
    }),
  });
  for (const [folder, option] of [['legacy', 'project'], ['service', 'projectService']]) {
    const pkg = `packages/${folder}`;
    f.write(`${pkg}/eslint.config.mjs`, `export default [{ languageOptions: { parserOptions: { ${option}: true } } }];`);
    f.write(`${pkg}/promise.js`, 'Promise.resolve(1);');
    f.write(`${pkg}/type.ts`, `export const value: number = 'text';`);
    const result = f.run(`${pkg}/promise.js`, `${pkg}/type.ts`);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /no-floating-promises/);
    assert.match(result.stdout, /TS2322/);
  }
});

test('하위 ESLint의 projectService 상대 경로는 설정 파일 위치를 기준으로 사용한다', t => {
  const config = JSON.stringify({
    compilerOptions: { allowJs: true, noEmit: true, target: 'ES2022' }, include: ['src'],
  });
  const f = fixture(t, { 'tsconfig.json': config, 'src/index.js': 'export const index = 1;' });
  for (const options of [{ allowDefaultProject: ['tool.js'] }, {
    allowDefaultProject: ['tool.js'], defaultProject: './tsconfig.tools.json',
  }]) {
    const pkg = 'packages/web';
    f.write(`${pkg}/eslint.config.mjs`, `export default [{ languageOptions: { parserOptions: {
      projectService: ${JSON.stringify(options)},
    } } }];`);
    f.write(`${pkg}/tsconfig.json`, config);
    f.write(`${pkg}/tsconfig.tools.json`, config);
    f.write(`${pkg}/src/index.js`, 'export const index = 1;');
    f.write(`${pkg}/tool.js`, 'Promise.resolve(1);');
    const result = f.run(`${pkg}/tool.js`);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /no-floating-promises/);
  }
});

test('JS가 참조 프로젝트의 선언 파일 없이도 소스에서 Promise 타입을 읽는다', t => {
  const f = fixture(t, {
    'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './app' }, { path: './lib' }] }),
    'app/jsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'Preserve', moduleResolution: 'Bundler' },
      include: ['index.js'], references: [{ path: '../lib' }],
    }),
    'app/index.js': `import { save } from '../lib/index.js'; save();`,
    'lib/tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2022', composite: true, outDir: 'dist' }, include: ['index.ts'],
    }),
    'lib/index.ts': 'export async function save() { return 1; }',
  });
  const result = f.run('app/index.js');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /no-floating-promises/);
  assert.deepEqual(readdirSync(join(f.project, 'lib')).sort(), ['index.ts', 'tsconfig.json']);
});

test('import를 통해 포함된 JS는 프로젝트 별칭을 사용하고 독립 스크립트도 검사한다', t => {
  const f = fixture(t, {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { allowJs: true, target: 'ES2022' }, include: ['packages/web/**/*.js'],
    }),
    'packages/web/tsconfig.json': JSON.stringify({
      compilerOptions: { allowJs: true, target: 'ES2022', module: 'Preserve', paths: { '@api': ['./src/api.js'] } },
      files: ['src/main.ts'],
    }),
    'packages/web/src/main.ts': `import './consumer.js'; import './other.js';`,
    'packages/web/src/api.js': 'export async function save() { return 1; }',
    'packages/web/src/consumer.js': `import { save } from '@api'; save();`,
    'packages/web/src/other.js': `import { save } from '@api'; void save();`,
    'standalone.js': 'Promise.resolve(1);',
  });
  const result = f.run('packages/web/src/consumer.js', 'packages/web/src/other.js', 'standalone.js');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal((result.stdout.match(/no-floating-promises/g) ?? []).length, 3);
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
  f.write('scripts/sample.ts', comparison);
  f.write('eslint.config.mjs', `export default [{ files: ['scripts/**/*.ts'], rules: {
    'ai-setting/typescript-diagnostics': 'off', '@typescript-eslint/no-floating-promises': 'off',
  } }];`);
  const basic = f.run('scripts/sample.ts');
  assert.equal(basic.status, 1, basic.stderr || basic.stdout);
  assert.match(basic.stdout, /eqeqeq/);
  assert.doesNotMatch(basic.stdout, /Parsing error|File ignored/);
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

test('사용자 파서의 타입 검사 실패를 기록하면서 다른 파일의 진단을 출력한다', t => {
  const f = fixture(t, {
    'eslint.config.mjs': `import { ESLint } from ${JSON.stringify(eslint)};
      const { languageOptions } = await new ESLint({ overrideConfigFile: true }).calculateConfigForFile('sample.js');
      const parser = { parse: (...args) => languageOptions.parser.parse(...args) };
      export default [{ files: ['custom.js'], languageOptions: { parser } }];`,
    'custom.js': 'export const value = 1;',
    'ordinary.js': 'Promise.resolve(1);',
  });
  const result = f.run('custom.js', 'ordinary.js');
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr, /custom\.js.*no-floating-promises/);
  assert.match(result.stdout, /ordinary\.js[\s\S]*no-floating-promises/);
});

test('프로젝트의 심볼릭 링크를 거치는 절대 파일 경로도 검사한다', t => {
  const f = fixture(t, { 'sample.js': 'Promise.resolve(1);' });
  const linked = join(f.parent, 'checkout');
  symlinkSync(f.project, linked, 'junction');
  const result = spawnSync(process.execPath, [runner, linked, join(linked, 'sample.js')], {
    cwd: f.parent, encoding: 'utf8', windowsHide: true, timeout: 20_000,
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /no-floating-promises/);
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
