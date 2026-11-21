import console from 'node:console';
import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { ESLint } from 'eslint';
import ts from 'typescript';
import tseslint from 'typescript-eslint';
import baseConfig, { promiseChecks, promiseRule, typescriptChecks } from './eslint.config.mjs';

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

function hasTypeContext(options = {}) {
  return Boolean(options.projectService || options.project || options.programs?.length);
}

function typesForFile(file, config, { cwd, project, findJavascriptProject }) {
  if (!config) return {};
  const { parser, parserOptions } = config.languageOptions;
  const isTypeScript = typescriptExtension.test(file);
  const checksPromise = config.rules?.[promiseRule]?.[0] > 0;
  const espree = !isTypeScript && checksPromise && parser.name === 'espree' ? parser : undefined;
  const hasTypes = hasTypeContext(parserOptions);
  const { allowDefaultProject, defaultProject } = parserOptions?.projectService ?? {};
  const configRelative = allowDefaultProject?.length || [parserOptions?.project, defaultProject].flat()
    .some(path => typeof path === 'string' && !isAbsolute(path));
  const rootDir = parserOptions?.tsconfigRootDir ?? (configRelative ? cwd : project);
  if (hasTypes) return { espree, rootDir };
  if (isTypeScript) {
    const checksDiagnostics = Object.keys(typescriptChecks.rules).some(rule => config.rules?.[rule]?.[0] > 0);
    return checksPromise || checksDiagnostics ? { mode: 'projectService', rootDir } : {};
  }
  if (!checksPromise) return {};

  const javascriptProject = findJavascriptProject(file);
  return { espree, mode: javascriptProject ? 'project' : 'inferred', javascriptProject, rootDir };
}

function withJavascriptTypes(parser, typeSyntaxErrors) {
  return {
    parseForESLint(code, options) {
      // Keep the normal JavaScript grammar check before supplying a typed AST to ESLint.
      const ast = parser.parse(code, options);
      if (!hasTypeContext(options)) return { ast };
      try {
        const { ast: typedAst, services, visitorKeys } = tseslint.parser.parseForESLint(code, options);
        // ESLint computes the JS scope using the configured ECMAScript version and globals.
        return { ast: typedAst, services, visitorKeys };
      } catch (error) {
        if (error.name === 'TSError') typeSyntaxErrors.set(options.filePath, error.message);
        throw error;
      }
    },
  };
}

function requiresTypeChecking(config, ruleId) {
  if (ruleId === promiseRule) return true;
  const separator = ruleId.lastIndexOf('/');
  if (separator === -1) return false;
  const rule = config.plugins[ruleId.slice(0, separator)]?.rules?.[ruleId.slice(separator + 1)];
  return rule?.meta?.docs?.requiresTypeChecking === true;
}

function configuredJavascriptProgram(candidate) {
  const { fileNames, options, projectReferences } = candidate.parsed;
  if (!candidate.program) {
    const host = ts.createCompilerHost(options, true);
    host.useSourceOfProjectReferenceRedirect = () => true;
    candidate.program = ts.createProgram({ rootNames: fileNames, options, projectReferences, host });
  }
  return candidate.program;
}

function javascriptProjectLookup(root) {
  const cache = new Map();
  const pathKey = path => ts.sys.useCaseSensitiveFileNames ? resolve(path) : resolve(path).toLowerCase();
  const host = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  };

  function findInConfig(configFile, file, candidates) {
    const key = pathKey(configFile);
    if (candidates.has(key) || !ts.sys.fileExists(configFile)) return;
    if (!cache.has(key)) {
      const parsed = ts.getParsedCommandLineOfConfigFile(configFile, undefined, host);
      cache.set(key, {
        configFile, parsed,
        files: new Set(parsed.fileNames.map(pathKey)),
        references: (parsed.projectReferences ?? []).map(ts.resolveProjectReferencePath),
      });
    }
    const candidate = cache.get(key);
    candidates.set(key, candidate);
    if (candidate.files.has(file)) return candidate;
    for (const reference of candidate.references) {
      const found = findInConfig(reference, file, candidates);
      if (found) return found;
    }
  }

  return file => {
    const key = pathKey(file);
    for (let directory = dirname(file); inProject(root, directory); directory = dirname(directory)) {
      const candidates = new Map();
      for (const name of ['tsconfig.json', 'jsconfig.json']) {
        const found = findInConfig(join(directory, name), key, candidates);
        if (found) return found;
      }

      // Resolve imports in the closer config before checking any parent config.
      for (const candidate of candidates.values()) {
        const { fileNames, options } = candidate.parsed;
        if (!fileNames.length || !(options.allowJs ?? options.checkJs)) continue;
        if (configuredJavascriptProgram(candidate).getSourceFile(file)) return candidate;
      }
      if (directory === root) break;
    }
  };
}

function createJavascriptProgram(files, project) {
  const options = {
    allowJs: true, noEmit: true, jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => project;
  return ts.createProgram(files, options, host);
}

async function lintGroup(options, baseConfig, files, project, findJavascriptProject, results) {
  const typeOptions = { cwd: options.cwd, project, findJavascriptProject };
  const createGroup = baseConfig => ({
    baseConfig, linter: new ESLint({ ...options, baseConfig }), batches: [],
  });
  const combined = createGroup(baseConfig);
  const byPlugin = new Map([[undefined, combined]]);
  let projectOnly;
  let failed = false;
  for (const file of files) {
    try {
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
      const context = typesForFile(file, config, typeOptions);
      const matching = group.batches.find(batch => batch.mode === context.mode
        && batch.espree === context.espree && batch.rootDir === context.rootDir
        && batch.javascriptProject === context.javascriptProject);
      if (matching) matching.files.push(file);
      else group.batches.push({ ...context, files: [file] });
    } catch (error) {
      console.error(`ESLint 실행 실패 (${file}): ${error.message}`);
      failed = true;
    }
  }

  for (const group of byPlugin.values()) {
    for (const { mode, espree, javascriptProject, rootDir, files } of group.batches) {
      const languageOptions = {};
      const typeSyntaxErrors = new Map();
      if (espree) languageOptions.parser = withJavascriptTypes(espree, typeSyntaxErrors);
      const parserOptions = rootDir ? { tsconfigRootDir: rootDir } : {};
      if (mode === 'projectService') parserOptions.projectService = true;
      if (mode === 'project') {
        const { configFile, parsed } = javascriptProject;
        // Let the parser report config errors before treating a program as valid.
        if (!parsed.errors.length) parserOptions.programs = [configuredJavascriptProgram(javascriptProject)];
        else parserOptions.project = [configFile];
      }
      if (mode === 'inferred') parserOptions.programs = [createJavascriptProgram(files, project)];
      if (mode || rootDir) languageOptions.parserOptions = parserOptions;
      const linter = mode || espree || rootDir ? new ESLint({
        ...options, baseConfig: group.baseConfig, overrideConfig: { languageOptions },
      }) : group.linter;
      for (const file of files) {
        try {
          const checked = await linter.lintFiles([file]);
          const typeError = typeSyntaxErrors.get(file);
          if (!typeError) {
            results.push(...checked);
            continue;
          }

          console.error(`JavaScript Promise 검사 실패 (${file}): ${typeError}`);
          failed = true;
          const config = await group.linter.calculateConfigForFile(file);
          const basicLinter = new ESLint({
            ...options, baseConfig: group.baseConfig,
            ruleFilter: ({ ruleId }) => !requiresTypeChecking(config, ruleId),
          });
          results.push(...await basicLinter.lintFiles([file]));
        } catch (error) {
          console.error(`ESLint 실행 실패 (${file}): ${error.message}`);
          failed = true;
        }
      }
    }
  }
  return failed;
}

async function main([projectPath, ...input]) {
  if (!projectPath || !input.length) {
    throw new Error('사용법: node lint.mjs <프로젝트 폴더> <JS·TS 파일> [...]');
  }
  const requestedProject = resolve(projectPath);
  const project = realpathSync(requestedProject);
  if (!statSync(project).isDirectory()) throw new Error('프로젝트 폴더를 확인하세요.');

  const files = new Set();
  for (const name of input) {
    const requestedFile = resolve(requestedProject, name);
    const file = inProject(requestedProject, requestedFile)
      ? resolve(project, relative(requestedProject, requestedFile))
      : requestedFile;
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
  let failed = false;
  const lintConfig = [...baseConfig, typescriptChecks, promiseChecks];
  const findJavascriptProject = javascriptProjectLookup(project);
  for (const [config, targets] of groups) {
    const cwd = config ? dirname(config) : project;
    const options = { cwd, overrideConfigFile: config ?? true, globInputPaths: false };
    if (await lintGroup(options, lintConfig, targets, project, findJavascriptProject, results)) failed = true;
  }
  const formatted = await (await discover.loadFormatter('stylish')).format(results);
  if (formatted) process.stdout.write(formatted);
  if (failed || results.some(result => result.fatalErrorCount)) return 2;
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
