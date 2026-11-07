import { spawnSync } from 'node:child_process';
import { accessSync, constants, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellCommands } from '../hooks/command-guard/shell-commands.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const windows = process.platform === 'win32';
const codexOnly = new Set(['antigravity-worker', 'task-lessons']);
const hooks = [
  ['prompt-secret-checker', 'secret-checker', 'UserPromptSubmit', 'PreInvocation'],
  ['code-quality-review', 'code-quality-review', 'UserPromptSubmit', 'PreInvocation', 'Stop'],
  ['command-guard', 'command-guard', 'PreToolUse', 'PreToolUse'],
];
const commitHook = join('hooks', 'commit-secret-checker');
const commitFiles = new Set(['pre-commit', 'commit-secret-checker.mjs', 'gitleaks.toml']);
const testFile = name => name.endsWith('.test.mjs') || name === 'test-temp.mjs';
let failed = false;

function report(label, problems = []) {
  console.log(`${problems.length ? '확인 필요' : '일치'}  ${label}`);
  for (const problem of problems) console.log(`  - ${problem}`);
  failed ||= problems.length > 0;
}

function differences(source, target, name, include) {
  const original = lstatSync(source);
  const installed = lstatSync(target, { throwIfNoEntry: false });
  if (!installed) return [`${name} 누락`];
  if (original.isDirectory() && installed.isDirectory()) {
    return readdirSync(source, { withFileTypes: true }).filter(include).flatMap(entry =>
      differences(join(source, entry.name), join(target, entry.name), `${name}/${entry.name}`, include));
  }
  if (!original.isFile() || !installed.isFile()) return [`${name} 파일 형식 확인 (실제 복사본 필요)`];
  return readFileSync(source).equals(readFileSync(target)) ? [] : [`${name} 내용 불일치`];
}

function checkCopy(label, source, target, include = () => true) {
  try {
    report(label, differences(join(repo, source), target, basename(source), include));
  } catch {
    report(label, ['원본 또는 설치본을 읽을 수 없음']);
  }
}

function runnable(path) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, windows ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executable(program) {
  if (isAbsolute(program)) return runnable(program);
  if (program !== 'node' && program !== 'gitleaks') return false;
  const file = windows ? `${program}.exe` : program;
  return (process.env.PATH ?? '').split(delimiter).filter(Boolean).some(path => runnable(join(path, file)));
}

function invocation(command) {
  if (typeof command !== 'string') return {};
  const encoded = windows && /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand ([\w+/=]+)$/i.exec(command);
  const text = encoded ? Buffer.from(encoded[1], 'base64').toString('utf16le') : command;
  let gitleaks;
  for (const commandWords of shellCommands(text, windows)) {
    const words = windows ? commandWords.map(word => word.replace(/([\u2018-\u201b])\1/g, '$1')) : commandWords;
    if (windows && words[0]?.toLowerCase() === '$env:ai_setting_gitleaks_bin' && words[1] === '=') {
      gitleaks = words[2];
      continue;
    }
    const offset = words[0]?.startsWith('AI_SETTING_GITLEAKS_BIN=') ? 1 : 0;
    if (offset) gitleaks = words[0].slice('AI_SETTING_GITLEAKS_BIN='.length);
    const [node, script, ...args] = words.slice(offset);
    if (script && /^node(?:\.exe)?$/i.test(basename(node))) return { node, script, args, gitleaks };
  }
  return {};
}

function readRegistrations(home, codex) {
  const config = JSON.parse(readFileSync(join(home, 'hooks.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid hook configuration');
  const sections = codex ? [config.hooks] : Object.values(config);
  return sections.flatMap(section => Object.entries(section ?? {}).flatMap(([event, groups]) => {
    if (!Array.isArray(groups)) return [];
    return groups.flatMap(group => (group?.hooks ?? [group]).map(handler => ({
      ...invocation(handler?.type === 'command' ? handler.command : undefined),
      event, matcher: group?.matcher,
      enabled: section.enabled !== false && group?.enabled !== false && handler?.enabled !== false,
    })));
  }));
}

function samePath(a, b) {
  const key = path => windows ? path.toLowerCase() : path;
  if (key(resolve(a)) === key(resolve(b))) return true;
  try { return key(realpathSync(a)) === key(realpathSync(b)); }
  catch { return false; }
}

function matchesTool(matcher, tool) {
  try { return matcher === undefined || new RegExp(matcher).test(tool); }
  catch { return false; }
}

function checkRegistration(registrations, label, path, event, tool, prepare, secret) {
  const found = registrations.filter(entry => entry.event === event && entry.script && basename(entry.script) === basename(path));
  const problems = [];
  if (found.length !== 1) problems.push(found.length ? '같은 이벤트에 중복 등록됨' : '등록 누락');
  for (const entry of found) {
    if (!entry.enabled) problems.push('등록 비활성화됨');
    if (!isAbsolute(entry.script) || !samePath(entry.script, path)) problems.push('등록이 예상 설치본을 가리키지 않음');
    if (!executable(entry.node)) problems.push('등록된 Node 실행 파일을 찾을 수 없음');
    if (entry.args.join(' ') !== (prepare ? '--prepare' : '')) problems.push('등록 실행 인자 불일치');
    if (tool && !matchesTool(entry.matcher, tool)) problems.push('터미널 도구 matcher 불일치');
    if (secret && !executable(entry.gitleaks ?? (process.env.AI_SETTING_GITLEAKS_BIN || 'gitleaks'))) {
      problems.push('Gitleaks 실행 파일을 찾을 수 없음');
    }
  }
  report(`${label} · ${event}`, problems);
}

function checkClient(codex) {
  const name = codex ? 'Codex' : 'Antigravity';
  const adapter = codex ? 'codex' : 'gemini';
  const home = codex ? resolve(process.env.CODEX_HOME || join(homedir(), '.codex')) : join(homedir(), '.gemini', 'config');
  const guide = codex ? join(home, 'AGENTS.md') : join(homedir(), '.gemini', 'GEMINI.md');
  checkCopy(`${name} 전역 지침`, join('global', 'AGENTS.md'), guide);
  for (const skill of readdirSync(join(repo, 'skills'), { withFileTypes: true })) {
    if (skill.isDirectory() && (codex || !codexOnly.has(skill.name))) {
      const source = join('skills', skill.name);
      checkCopy(`${name} ${source}`, source, join(home, source), entry => !testFile(entry.name));
    }
  }
  let registrations;
  try { registrations = readRegistrations(home, codex); }
  catch (error) {
    report(`${name} hooks.json`, [error.code === 'ENOENT' ? '등록 파일 누락' : '등록 파일을 읽거나 해석할 수 없음']);
  }
  for (const [hook, entry, codexEvent, geminiEvent, stop] of hooks) {
    const source = join('hooks', hook);
    const installed = join(home, source);
    const label = `${name} ${hook}`;
    checkCopy(label, source, installed, file => file.isDirectory() ? file.name === adapter
      : !testFile(file.name) && (!file.name.endsWith('.md') || file.name === 'REVIEW.md'));
    if (!registrations) continue;
    const script = join(installed, adapter, `${adapter}-${entry}.mjs`);
    const tool = hook === 'command-guard' ? (codex ? 'Bash' : 'run_command') : undefined;
    checkRegistration(registrations, label, script, codex ? codexEvent : geminiEvent, tool, Boolean(stop), hook === 'prompt-secret-checker');
    if (stop) checkRegistration(registrations, label, script, stop);
  }
  console.log(`${name} 훅 신뢰·새 세션에서의 실행 여부는 앱에서 확인`);
}

function gitHooksPath(scope) {
  const result = spawnSync('git', ['config', ...scope, '--path', '--get', 'core.hooksPath'], {
    cwd: repo, encoding: 'utf8', timeout: 3000, windowsHide: true,
  });
  if (result.status === 1) return '';
  if (result.status !== 0) throw new Error('Cannot read Git configuration');
  return result.stdout.replace(/\r?\n$/, '');
}

function checkGit() {
  const label = 'Git 전역 pre-commit';
  try {
    const global = gitHooksPath(['--global']);
    const effective = gitHooksPath([]);
    if (!global || !isAbsolute(global)) {
      report(label, [global ? 'core.hooksPath가 절대 경로가 아님' : 'core.hooksPath 미등록']);
    } else {
      checkCopy(label, commitHook, global, entry => commitFiles.has(entry.name));
      report('Git 이 저장소의 pre-commit 경로', effective && samePath(effective, global) && runnable(join(global, 'pre-commit'))
        ? [] : ['전역 경로가 덮어써졌거나 pre-commit을 실행할 수 없음']);
    }
  } catch {
    report(label, ['Git 설정을 읽을 수 없음']);
  }
  const brew = '/opt/homebrew/bin/gitleaks';
  const scanner = process.env.AI_SETTING_GITLEAKS_BIN || (!windows && runnable(brew) ? brew : 'gitleaks');
  report('Git 커밋 훅 Gitleaks', executable(scanner) ? [] : ['Gitleaks 실행 파일을 찾을 수 없음']);
}

const [target, ...extra] = process.argv.slice(2);
if (extra.length || (target && !['codex', 'antigravity', 'git'].includes(target))) {
  console.error('사용법: node scripts/check-install.mjs [codex|antigravity|git]');
  process.exitCode = 2;
} else {
  report(`Node.js ${process.version}`, Number(process.versions.node.split('.')[0]) >= 22 ? [] : ['Node.js 22 이상 필요']);
  if (!target || target === 'codex') checkClient(true);
  if (!target || target === 'antigravity') checkClient(false);
  if (!target || target === 'git') checkGit();
  process.exitCode = failed ? 1 : 0;
}
