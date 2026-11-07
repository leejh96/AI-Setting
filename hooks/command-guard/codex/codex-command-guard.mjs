import { hookCommand, runHook } from '../hook-cli.mjs';

runHook(
  () => ({
    description: '터미널 명령 실행 전에 위험한 Git·파일 명령을 검사합니다.',
    hooks: {
      PreToolUse: [{
        matcher: '^Bash$',
        hooks: [{ type: 'command', command: hookCommand(import.meta.url, false), timeout: 5 }],
      }],
    },
  }),
  (event) => {
    if (event?.hook_event_name !== 'PreToolUse' || event.tool_name !== 'Bash') return {};
    return { command: event.tool_input?.command, cwd: event.tool_input?.workdir || event.cwd };
  },
  ({ decision, reason }) => {
    if (decision === 'allow') return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    };
  },
);
