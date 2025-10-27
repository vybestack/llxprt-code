/**
 * Shared helpers for emitting high-visibility warnings when bundled defaults fail to load.
 */

const reported = new Set<string>();

/**
 * Emits a single warning per filename to alert users when defaults are missing.
 * The CLI keeps running, but we strongly advise restarting after fixing the install.
 */
export function reportMissingPrompt(
  filename: string,
  context: string,
  detail?: string,
): void {
  if (reported.has(filename)) {
    return;
  }
  reported.add(filename);

  const banner = '⚠️  LLxprt prompt warning';
  const instructions =
    'Prompt defaults could not be loaded. Model behavior may be degraded. ' +
    'Rebuild the CLI bundle or reinstall prompts, then retry.';

  const detailLine = detail ? `Details: ${detail}` : null;

  const lines = [
    banner,
    `Context: ${context}`,
    `File: ${filename}`,
    instructions,
  ];
  if (detailLine) {
    lines.push(detailLine);
  }

  console.error(lines.join('\n'));
}
