/**
 * @plan PLAN-20251215-OLDUI-SCROLL.P03
 * @requirement REQ-456.1
 *
 * Runs the tmux+LLM “realistic scrollback” baseline behind an env gate.
 * This should FAIL pre-fix when `LLXPRT_E2E_OLDUI=1` is set.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const isEnabled = process.env.LLXPRT_E2E_OLDUI === '1';

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

runTest('old Ink UI scrollback regression (tmux baseline)', () => {
  const repoRoot = getRepoRoot();
  const result = spawnSync(
    'node',
    [
      'scripts/oldui-tmux-harness.js',
      '--script',
      'scripts/oldui-tmux-script.llm-tool-scrollback-realistic.llxprt.json',
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
      `old UI tmux baseline failed (exit ${result.status})\nartifacts: ${artifacts}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    );
  }
});

/**
 * @plan PLAN-20251215-OLDUI-SCROLL.P03
 * @requirement REQ-456.2
 */
const isGeminiEnabled = process.env.LLXPRT_E2E_GEMINI === '1';
const runGeminiTest = isGeminiEnabled ? test : test.skip;

runGeminiTest('gemini CLI scrollback control (tmux baseline)', () => {
  const repoRoot = getRepoRoot();
  const result = spawnSync(
    'node',
    [
      'scripts/oldui-tmux-harness.js',
      '--script',
      'scripts/oldui-tmux-script.llm-tool-scrollback-realistic.gemini.json',
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
      `gemini control baseline failed (exit ${result.status})\nartifacts: ${artifacts}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    );
  }
});
