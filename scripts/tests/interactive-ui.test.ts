/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Interactive UI tests using the tmux harness.
 *
 * These tests exercise real terminal rendering, keyboard interaction,
 * and screen capture via tmux — covering slash autocomplete, approval dialog
 * rendering, and deterministic UI behavior that cannot be validated
 * with unit tests alone.
 *
 * All tests are gated behind LLXPRT_E2E_TMUX=1 and are skipped
 * unless that env var is set. The dedicated interactive-ui.yml
 * workflow sets this variable on ubuntu-latest.
 *
 * Artifact output directory is controlled by LLXPRT_TMUX_ARTIFACT_DIR,
 * falling back to os.tmpdir() when unset.
 */

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

const isEnabled = process.env.LLXPRT_E2E_TMUX === '1';
const runTmuxE2E = isEnabled ? it : it.skip;

/**
 * Resolve a stable artifact directory for a given test name.
 * Uses LLXPRT_TMUX_ARTIFACT_DIR if set, otherwise os.tmpdir().
 */
function getArtifactDir(testName: string): string {
  const base = process.env.LLXPRT_TMUX_ARTIFACT_DIR ?? os.tmpdir();
  return path.join(base, testName);
}

/**
 * Extract the artifacts path from harness stdout/stderr output.
 */
function extractArtifactsPath(text: string): string | null {
  const match = text.match(/^artifacts:[ \t]+(\S[^\r\n]*)$/m);
  return match?.[1] ?? null;
}

interface HarnessResult {
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
}

const artifactDirs: string[] = [];

/**
 * Run the tmux harness with a given script and stable artifact dir.
 */
function runHarness(
  scriptName: string,
  testName: string,
  extraArgs: string[] = [],
  extraEnv: NodeJS.ProcessEnv = {},
): HarnessResult {
  const scriptPath = path.join(projectRoot, 'scripts', scriptName);
  const harnessPath = path.join(projectRoot, 'scripts/tmux-harness.js');
  const artifactDir = getArtifactDir(testName);
  artifactDirs.push(artifactDir);

  const result = spawnSync(
    process.execPath,
    [
      harnessPath,
      '--script',
      scriptPath,
      '--out-dir',
      artifactDir,
      ...extraArgs,
    ],
    {
      encoding: 'utf8',
      cwd: projectRoot,
      timeout: 300_000,
      env: { ...process.env, FORCE_COLOR: '0', NODE_OPTIONS: '', ...extraEnv },
    },
  );

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
    error: result.error ?? undefined,
  };
}

/**
 * Assert harness succeeded, surfacing artifacts path on failure.
 */
function assertHarnessSuccess(result: HarnessResult): void {
  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const artifacts =
      extractArtifactsPath(result.stdout) ??
      extractArtifactsPath(result.stderr) ??
      'unknown';
    throw new Error(
      `Harness exited with status ${result.status}\n` +
        `artifacts: ${artifacts}\n` +
        `--- stdout ---\n${result.stdout}\n` +
        `--- stderr ---\n${result.stderr}`,
    );
  }
}

afterAll(() => {
  if (artifactDirs.length > 0) {
    console.log('Interactive UI artifact directories:');
    for (const dir of artifactDirs) {
      console.log(`  ${dir}`);
    }
  }
});

describe('Interactive UI (tmux harness)', () => {
  runTmuxE2E(
    'slash autocomplete opens, navigates, and dismisses',
    () => {
      const result = runHarness(
        'tmux-script.slash-autocomplete.json',
        'slash-autocomplete',
      );
      assertHarnessSuccess(result);
    },
    300_000,
  );

  runTmuxE2E(
    'tool approval dialog appears and accepts approval',
    () => {
      const result = runHarness(
        'tmux-script.approval-ui.json',
        'approval-dialog',
        [],
        {
          LLXPRT_FAKE_RESPONSES: path.join(
            projectRoot,
            'scripts/fixtures/approval-ui.responses.jsonl',
          ),
        },
      );
      assertHarnessSuccess(result);
    },
    300_000,
  );

  runTmuxE2E(
    'preserves assistant markdown hard line breaks',
    () => {
      const result = runHarness(
        'tmux-script.issue2208-newlines.fake.json',
        'issue2208-newlines',
        [],
        {
          LLXPRT_FAKE_RESPONSES: path.join(
            projectRoot,
            'scripts/fixtures/issue2208-newlines.responses.jsonl',
          ),
        },
      );
      assertHarnessSuccess(result);
    },
    300_000,
  );
});
