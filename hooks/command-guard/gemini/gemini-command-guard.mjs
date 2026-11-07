import { hookCommand, runHook } from '../hook-cli.mjs';

runHook(
  () => ({
    'ai-setting-command-guard': {
      enabled: true,
      PreToolUse: [{
        matcher: '^run_command$',
        hooks: [{ type: 'command', command: hookCommand(import.meta.url, true), timeout: 5 }],
      }],
    },
  }),
  (event) => {
    if (event?.toolCall?.name !== 'run_command') return {};
    const { args } = event.toolCall;
    // Antigravity can omit Cwd for commands run from the workspace.
    return {
      command: args?.CommandLine,
      cwd: args?.Cwd || event.workspacePaths?.[0] || process.cwd(),
    };
  },
  ({ decision, reason }) => ({ decision, reason }),
);
