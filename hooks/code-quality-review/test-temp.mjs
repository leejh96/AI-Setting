import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createWatchTestRoot() {
  // Nested fixtures must still fit macOS's Unix socket path limit.
  const parent = realpathSync(process.platform === 'darwin' ? '/tmp' : tmpdir());
  return { parent, root: mkdtempSync(join(parent, 'quality-')) };
}
