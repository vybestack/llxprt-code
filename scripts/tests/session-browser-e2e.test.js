/* global describe, it */
/**
 * End-to-end tests for the Session Browser UI using tmux harness.
 *
 * These tests verify real user-visible behavior:
 * - /continue command opens the session browser dialog
 * - Keyboard navigation works (arrows, Tab, Escape)
 * - Search filtering works
 * - Sort cycling works
 * - Session selection and resume works
 * - Delete confirmation works
 *
 * Run with: node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.session-browser.json --assert
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

const isEnabled = process.env.LLXPRT_E2E_OLDUI_TMUX === '1';
const runTmuxE2E = isEnabled ? it : it.skip;

function runHarness(scriptName, extraArgs = []) {
  const scriptPath = path.join(projectRoot, 'scripts', scriptName);
  const harnessPath = path.join(projectRoot, 'scripts/oldui-tmux-harness.js');

  const result = spawnSync(
    'node',
    [harnessPath, '--script', scriptPath, '--assert', ...extraArgs],
    {
      encoding: 'utf8',
      cwd: projectRoot,
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: '0' },
    },
  );

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
    error: result.error,
  };
}

describe('Session Browser E2E', () => {
  runTmuxE2E(
    'opens session browser with /continue and supports keyboard navigation',
    () => {
      const result = runHarness('oldui-tmux-script.session-browser.json');

      if (result.error) {
        throw result.error;
      }

      if (result.status !== 0) {
        console.error('STDOUT:', result.stdout);
        console.error('STDERR:', result.stderr);
        throw new Error(`Harness exited with status ${result.status}`);
      }
    },
    120000,
  );
});
