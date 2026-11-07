import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createWatchTestRoot() {
  // Nested fixtures must still fit macOS's Unix socket path limit.
  // Git for Windows reports long paths even if TEMP contains an 8.3 short name.
  const parent = process.platform === 'win32'
    ? realpathSync.native(tmpdir())
    : realpathSync(process.platform === 'darwin' ? '/tmp' : tmpdir());
  return { parent, root: mkdtempSync(join(parent, 'quality-')) };
}
