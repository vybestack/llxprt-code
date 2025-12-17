/**
 * @plan PLAN-20251215-OLDUI-SCROLL.P05
 * @requirement REQ-456.5
 *
 * Runs the deterministic tmux reproduction that previously caused the legacy
 * Ink UI scrollbox to appear to “scroll up then down” while tools were running.
 *
 * Root cause: LoadingIndicator could wrap its timer onto a second line on narrow
 * terminals, changing the mainControls height and forcing the scroll viewport
 * to re-anchor.
 *
 * This runs behind an env gate because it requires tmux:
 *   LLXPRT_E2E_OLDUI_TMUX=1 npm run test:scripts
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const isEnabled = process.env.LLXPRT_E2E_OLDUI_TMUX === '1';
const runTest = isEnabled ? test : test.skip;

const getRepoRoot = () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '../..');
};

const extractArtifactsPath = (text) => {
  const match = text.match(/^artifacts:\s+(?<path>.+)$/m);
  return match?.groups?.path ?? null;
};

runTest('old Ink UI loading indicator does not wrap (tmux)', () => {
  const repoRoot = getRepoRoot();
  const result = spawnSync(
    'node',
    [
      'scripts/oldui-tmux-harness.js',
      '--script',
      'scripts/oldui-tmux-script.scroll-jitter-phrase-change.shellmode.json',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env },
      encoding: 'utf8',
      timeout: 5 * 60 * 1000,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const artifacts =
      extractArtifactsPath(stdout) ?? extractArtifactsPath(stderr) ?? 'unknown';
    throw new Error(
      `old UI tmux nowrap regression failed (exit ${result.status})\nartifacts: ${artifacts}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    );
  }
});
