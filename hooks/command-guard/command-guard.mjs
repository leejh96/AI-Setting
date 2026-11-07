import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { shellCommands } from './shell-commands.mjs';

const protectedBranches = new Set(['main', 'master', 'develop']);
const shellPrefixes = new Set(['!', '{', 'if', 'then', 'elif', 'else', 'while', 'until', 'do']);
const commandWrappers = new Set(['command', 'exec', 'env', 'sudo', 'nohup', 'time']);
const shellExecutables = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const assignment = /^[a-z_]\w*=/i;

function executable(word) {
  return word.split(/[/\\]/).at(-1).replace(/\.exe$/i, '').toLowerCase();
}

function deny(reason) {
  return { decision: 'deny', reason };
}

function options(args, valueOptions = [], attachedValueOptions = []) {
  const flags = new Set();
  const operands = [];
  let parsingOptions = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (parsingOptions && arg === '--') {
      parsingOptions = false;
    } else if (parsingOptions && arg.startsWith('--')) {
      const option = arg.split('=', 1)[0];
      flags.add(option);
      if (arg === option && valueOptions.includes(option)) i++;
    } else if (parsingOptions && /^-[^-]/.test(arg)) {
      for (const [offset, char] of [...arg.slice(1)].entries()) {
        const option = '-' + char;
        flags.add(option);
        if (valueOptions.includes(option)) {
          if (offset === arg.length - 2) i++;
          break;
        }
        if (attachedValueOptions.includes(option)) break;
      }
    } else {
      operands.push(arg);
    }
  }
  return { flags, operands };
}

function dryRun(flags) {
  return !flags.has('--no-dry-run') && (flags.has('-n') || flags.has('--dry-run'));
}

function gitCommand(args) {
  let hookOverride = false;
  let index = 0;
  while (args[index]?.startsWith('-')) {
    const arg = args[index++];
    if (arg === '-c' || arg.startsWith('-c') || arg === '--config-env' || arg.startsWith('--config-env=')) {
      const value = arg === '-c' || arg === '--config-env' ? args[index++]
        : arg.startsWith('-c') ? arg.slice(2) : arg.slice('--config-env='.length);
      hookOverride ||= /^core\.hookspath(?:=|$)/i.test(value ?? '');
    } else if (['-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix'].includes(arg)) {
      index++;
    } else if (!/^(?:-C.+|--(?:git-dir|work-tree|namespace|super-prefix|exec-path)=.*|--bare|--no-pager|-P|--paginate|-p|--literal-pathspecs|--no-optional-locks|--no-replace-objects|--no-lazy-fetch)$/.test(arg)) {
      return;
    }
  }
  const operation = args[index++];
  const argumentsAfterOperation = args.slice(index);
  if (operation === 'push') {
    const { flags, operands } = options(argumentsAfterOperation, [
      '--repo', '--receive-pack', '--exec', '--push-option', '-o',
    ]);
    if (dryRun(flags)) return;
    if (hookOverride || flags.has('--no-verify')) return deny('Git push의 로컬 검사를 우회하는 옵션입니다.');
    if (flags.has('-f') || flags.has('--force') || flags.has('--mirror') || operands.some(arg => arg.startsWith('+'))) {
      return deny('원격 Git 이력을 강제로 덮어쓰거나 삭제할 수 있습니다.');
    }
    const deleteFlag = flags.has('-d') || flags.has('--delete');
    const refspecs = flags.has('--repo') ? operands : operands.slice(1);
    const destinations = refspecs.filter(arg => arg !== ':' && (arg.startsWith(':') || deleteFlag))
      .map(arg => arg.replace(/^:/, '').replace(/^refs\/heads\//, ''));
    if (destinations.some(branch => protectedBranches.has(branch))) {
      return deny('보호 대상 원격 브랜치를 삭제하는 명령입니다.');
    }
    if (deleteFlag || destinations.length || flags.has('--prune')) return deny('원격 Git ref가 삭제될 수 있습니다.');
    if (flags.has('--force-with-lease')) return deny('원격 Git 이력을 다시 쓰는 명령입니다.');
    return;
  }

  if (operation === 'commit') {
    const { flags } = options(argumentsAfterOperation, [
      '-m', '-F', '-C', '-c', '-t', '--message', '--file', '--reuse-message', '--reedit-message',
      '--template', '--author', '--date', '--fixup', '--squash', '--trailer', '--pathspec-from-file',
    ], ['-S', '-u']);
    if (hookOverride || flags.has('-n') || flags.has('--no-verify')) {
      return deny('Gitleaks 등 Git 커밋 훅을 우회하는 옵션입니다.');
    }
    return;
  }

  const { flags, operands } = options(argumentsAfterOperation, [
    '-s', '--source', '-b', '-B', '--pathspec-from-file', '-e', '--exclude',
  ]);
  const forced = flags.has('-f') || flags.has('--force');
  if (operation === 'clean' && !dryRun(flags)) {
    if (flags.has('-x') || flags.has('-X')) return deny('Git이 무시하는 파일까지 강제로 삭제할 수 있습니다.');
    return deny('Git에서 추적하지 않는 파일을 삭제할 수 있습니다.');
  }
  const entireTree = operands.some(arg => ['.', './', '.\\', ':/', ':/.'].includes(arg));
  const stagedOnly = (flags.has('--staged') || flags.has('-S'))
    && !flags.has('--worktree') && !flags.has('-W');
  if ((operation === 'reset' && flags.has('--hard'))
    || (operation === 'restore' && entireTree && !stagedOnly)
    || (operation === 'checkout' && (forced || entireTree))) {
    return deny('작업 공간의 미커밋 변경이 사라질 수 있습니다.');
  }
  if ((operation === 'branch' && (flags.has('-D') || forced && (flags.has('-d') || flags.has('--delete'))))
    || (operation === 'worktree' && operands[0] === 'remove' && forced)
    || (operation === 'stash' && ['clear', 'drop'].includes(operands[0]))) {
    return deny('브랜치, 작업 공간 또는 stash의 작업이 사라질 수 있습니다.');
  }
}

function broadRemoval(target, context) {
  const { cwd, windows } = context;
  const paths = windows ? path.win32 : path.posix;
  if (/^(?:~|[$]HOME|\$\{HOME\}|%USERPROFILE%|\$env:USERPROFILE)(?:[/\\](?:\*|\.?)?)?$/i.test(target)
    || /^(?:\.[/\\])?\*$/.test(target)) return true;

  const resolved = paths.resolve(cwd, target);
  const key = (name) => windows ? name.toLowerCase() : name;
  if (key(resolved) === key(paths.parse(resolved).root) || key(resolved) === key(homedir())) return true;
  const relative = paths.relative(resolved, cwd);
  if (!relative || (!/^\.\.(?:[/\\]|$)/.test(relative) && !paths.isAbsolute(relative))) return true;
  return existsSync(paths.join(resolved, '.git'));
}

function findDeletes(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-delete') return true;
    if (/^-(?:i?(?:name|path|wholename|regex|lname)|type|newer|user|group)$/.test(arg)) i++;
  }
  return false;
}

function fileCommand(program, args, context) {
  const { flags, operands } = options(args);
  if (program === 'rm' && (flags.has('-r') || flags.has('-R') || flags.has('--recursive'))) {
    if (operands.some(target => broadRemoval(target, context))) return deny('홈, 작업 공간 또는 저장소 전체를 삭제할 수 있습니다.');
    return deny('지정 경로 아래의 파일과 디렉터리를 재귀적으로 삭제합니다.');
  }
  if (context.windows && ['remove-item', 'ri', 'rm', 'rmdir', 'rd', 'del', 'erase'].includes(program)
    && args.some(arg => /^(?:-recurse|\/s)$/i.test(arg))) {
    const targets = args.filter(arg => !arg.startsWith('-') && !/^\/[sq]$/i.test(arg));
    if (targets.some(target => broadRemoval(target, context))) return deny('홈, 작업 공간 또는 저장소 전체를 삭제할 수 있습니다.');
    return deny('지정 경로 아래의 파일과 디렉터리를 재귀적으로 삭제합니다.');
  }
  if (program === 'find' && findDeletes(args)) return deny('검색 결과에 해당하는 파일을 삭제할 수 있습니다.');
  if (program === 'rsync' && !dryRun(flags)
    && [...flags].some(flag => /^--(?:del|delete(?:-(?:before|during|delay|after|excluded|missing-args))?)$/.test(flag))) {
    return deny('동기화 대상의 파일을 삭제할 수 있습니다.');
  }
  if (program === 'chmod' && (flags.has('-R') || flags.has('--recursive')) && /^(?:0?777|a[+=]rwx)$/.test(operands[0] ?? '')) {
    return deny('여러 파일에 모든 사용자의 읽기·쓰기·실행 권한을 부여합니다.');
  }
}

function classifyWords(words, context, depth) {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (shellPrefixes.has(word) || assignment.test(word)) {
      index++;
    } else if (commandWrappers.has(executable(word))) {
      const wrapper = executable(word);
      index++;
      if (wrapper === 'command' && ['-v', '-V'].includes(words[index])) return;
      while (words[index]?.startsWith('-')) {
        const flag = words[index++];
        if (flag === '--') break;
        if (wrapper === 'sudo' && ['-u', '-g', '-h', '-p', '-C', '--user', '--group'].includes(flag)) index++;
        if (wrapper === 'env' && ['-u', '--unset', '-C', '--chdir'].includes(flag)) index++;
      }
    } else {
      break;
    }
  }
  if (index >= words.length) return;
  const program = executable(words[index]);
  const args = words.slice(index + 1);
  if (program === 'git') return gitCommand(args);
  if (depth < 4 && shellExecutables.has(program)) {
    const commandFlag = args.findIndex(arg => /^-[a-z]*c[a-z]*$/.test(arg));
    if (commandFlag !== -1 && args[commandFlag + 1]) return classify(args[commandFlag + 1], context, depth + 1);
  }
  return fileCommand(program, args, context);
}

function classify(command, context, depth) {
  for (const words of shellCommands(command, context.windows)) {
    const result = classifyWords(words, context, depth);
    if (result?.decision === 'deny') return result;
  }
  return { decision: 'allow' };
}

export function inspectCommand(command, cwd, platform = process.platform) {
  return classify(command, { cwd, windows: platform === 'win32' }, 0);
}
