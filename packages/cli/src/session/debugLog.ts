import { appendFileSync } from 'fs';
import { join } from 'path';

/**
 * Append a debug line to the cli-debug.log artifact when
 * `LLXPRT_TMUX_ARTIFACT_DIR` is set. Failures are swallowed so diagnostics
 * never affect CLI startup.
 */
export function appendInteractiveUiDebug(message: string): void {
  const artifactDir = process.env.LLXPRT_TMUX_ARTIFACT_DIR;
  if (!artifactDir) return;
  try {
    appendFileSync(join(artifactDir, 'cli-debug.log'), `${message}\n`);
  } catch {
    // Ignore diagnostics failures; they should not affect CLI startup.
  }
}
