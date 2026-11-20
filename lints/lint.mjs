import console from 'node:console';
import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { ESLint } from 'eslint';
import baseConfig from './eslint.config.mjs';

const typescriptPlugin = '@typescript-eslint';
const sourceExtension = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/u;

function inProject(project, path) {
  const name = relative(project, path);
  return name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name);
}

function typescriptPluginConflict(error) {
  return error.name === 'ConfigError' && error.message.includes(`Cannot redefine plugin "${typescriptPlugin}".`);
}

function withProjectPlugin(baseConfig, plugin) {
  return baseConfig.map(config => config.plugins?.[typescriptPlugin]
    ? { ...config, plugins: { ...config.plugins, [typescriptPlugin]: plugin } }
    : config);
}

async function lintGroup(options, baseConfig, files) {
  const combined = new ESLint({ ...options, baseConfig });
  try {
    return await combined.lintFiles(files);
  } catch (error) {
    if (!typescriptPluginConflict(error)) throw error;
  }

  // The project may load its own instance of the same TypeScript plugin.
  const projectOnly = new ESLint(options);
  const byPlugin = new Map();
  const results = [];
  for (const file of files) {
    let linter = combined;
    try {
      await combined.calculateConfigForFile(file);
    } catch (error) {
      if (!typescriptPluginConflict(error)) throw error;
      const plugin = (await projectOnly.calculateConfigForFile(file))?.plugins?.[typescriptPlugin];
      if (!plugin) throw error;
      if (!byPlugin.has(plugin)) {
        byPlugin.set(plugin, new ESLint({ ...options, baseConfig: withProjectPlugin(baseConfig, plugin) }));
      }
      linter = byPlugin.get(plugin);
    }
    results.push(...await linter.lintFiles(file));
  }
  return results;
}

async function main([projectPath, ...input]) {
  if (!projectPath || !input.length) {
    throw new Error('사용법: node lint.mjs <프로젝트 폴더> <JS·TS 파일> [...]');
  }
  const project = realpathSync(projectPath);
  if (!statSync(project).isDirectory()) throw new Error('프로젝트 폴더를 확인하세요.');

  const files = new Set();
  for (const name of input) {
    const file = resolve(project, name);
    if (!sourceExtension.test(file) || !inProject(project, file)) {
      throw new Error(`프로젝트 안의 JS·TS 파일을 지정하세요: ${name}`);
    }
    if (!statSync(file).isFile() || !inProject(project, realpathSync(file))) {
      throw new Error(`프로젝트 안의 일반 파일을 지정하세요: ${name}`);
    }
    files.add(file);
  }

  const discover = new ESLint({ cwd: project });
  const groups = new Map();
  for (const file of files) {
    const candidate = await discover.findConfigFile(file);
    const config = candidate && inProject(project, candidate) ? candidate : undefined;
    if (config && !inProject(project, realpathSync(config))) {
      throw new Error(`프로젝트 밖을 가리키는 ESLint 설정: ${config}`);
    }
    if (!groups.has(config)) groups.set(config, []);
    groups.get(config).push(file);
  }

  const results = [];
  for (const [config, targets] of groups) {
    const cwd = config ? dirname(config) : project;
    const options = { cwd, overrideConfigFile: config ?? true, globInputPaths: false };
    results.push(...await lintGroup(options, baseConfig, targets));
  }
  const formatted = await (await discover.loadFormatter('stylish')).format(results);
  if (formatted) process.stdout.write(formatted);
  if (results.some(result => result.fatalErrorCount)) return 2;
  if (results.some(result => result.errorCount)) return 1;
  console.log(`ESLint 검사 완료 (${files.size}개 파일 지정).`);
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`ESLint 실행 실패: ${error.message}`);
  process.exitCode = 2;
}
