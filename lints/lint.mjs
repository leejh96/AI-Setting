import console from 'node:console';
import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { ESLint } from 'eslint';
import baseConfig, { typescriptChecks } from './eslint.config.mjs';

const typescriptPlugin = '@typescript-eslint';
const sourceExtension = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/u;
const typescriptExtension = /\.(?:[cm]?ts|tsx)$/u;

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

function needsProjectService(file, config) {
  if (!typescriptExtension.test(file) || !config) return false;
  const checksEnabled = Object.keys(typescriptChecks.rules).some(rule => config.rules[rule]?.[0] > 0);
  const parserOptions = config.languageOptions.parserOptions ?? {};
  return checksEnabled && !parserOptions.projectService && !parserOptions.project && !parserOptions.programs?.length;
}

async function lintGroup(options, baseConfig, files) {
  const createGroup = baseConfig => ({
    baseConfig, linter: new ESLint({ ...options, baseConfig }), files: [], projectServiceFiles: [],
  });
  const combined = createGroup(baseConfig);
  const byPlugin = new Map([[undefined, combined]]);
  let projectOnly;
  const results = [];
  for (const file of files) {
    let group = combined;
    let config;
    try {
      config = await combined.linter.calculateConfigForFile(file);
    } catch (error) {
      if (!typescriptPluginConflict(error)) throw error;
      // The project may load its own instance of the same TypeScript plugin.
      projectOnly ??= new ESLint(options);
      const plugin = (await projectOnly.calculateConfigForFile(file))?.plugins?.[typescriptPlugin];
      if (!plugin) throw error;
      if (!byPlugin.has(plugin)) {
        byPlugin.set(plugin, createGroup(withProjectPlugin(baseConfig, plugin)));
      }
      group = byPlugin.get(plugin);
      config = await group.linter.calculateConfigForFile(file);
    }
    (needsProjectService(file, config) ? group.projectServiceFiles : group.files).push(file);
  }

  for (const group of byPlugin.values()) {
    if (group.files.length) results.push(...await group.linter.lintFiles(group.files));
    if (group.projectServiceFiles.length) {
      const linter = new ESLint({
        ...options, baseConfig: group.baseConfig,
        overrideConfig: { languageOptions: { parserOptions: { projectService: true } } },
      });
      results.push(...await linter.lintFiles(group.projectServiceFiles));
    }
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
  const lintConfig = [...baseConfig, {
    ...typescriptChecks, languageOptions: { parserOptions: { tsconfigRootDir: project } },
  }];
  for (const [config, targets] of groups) {
    const cwd = config ? dirname(config) : project;
    const options = { cwd, overrideConfigFile: config ?? true, globInputPaths: false };
    results.push(...await lintGroup(options, lintConfig, targets));
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
