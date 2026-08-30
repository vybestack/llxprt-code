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
 * rendering, first-run welcome onboarding, and deterministic UI behavior that
 * cannot be validated with unit tests alone.
 *
 * All tests are gated behind LLXPRT_E2E_TMUX=1 and are skipped
 * unless that env var is set. The dedicated interactive-ui.yml
 * workflow sets this variable on ubuntu-latest.
 *
 * Artifact output directory is controlled by LLXPRT_TMUX_ARTIFACT_DIR,
 * falling back to os.tmpdir() when unset.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'bun:test';
import { parseSamples } from '../memory/sample.ts';
import { assertBoundedPostClearRetention } from './memory/retention-checkpoints.ts';

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
  return path.resolve(base, testName);
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
type WelcomeState = 'completed' | 'clean';

/**
 * Run the tmux harness with a given script and stable artifact dir.
 */
function runHarness(
  scriptName: string,
  testName: string,
  extraArgs: string[] = [],
  extraEnv: NodeJS.ProcessEnv = {},
  timeoutMs = 300_000,
  welcomeState: WelcomeState = 'completed',
): HarnessResult {
  const scriptPath = path.join(projectRoot, 'scripts', scriptName);
  const harnessPath = path.join(projectRoot, 'scripts/tmux-harness.ts');
  const artifactDir = getArtifactDir(testName);
  const welcomeConfigPath = path.join(artifactDir, 'welcome-config.json');
  rmSync(artifactDir, { recursive: true, force: true });
  mkdirSync(artifactDir, { recursive: true });
  if (welcomeState === 'completed') {
    writeFileSync(
      welcomeConfigPath,
      JSON.stringify({ welcomeCompleted: true, skipped: true }, null, 2),
      'utf8',
    );
  }
  artifactDirs.push(artifactDir);

  const result = spawnSync(
    'bun',
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
      timeout: timeoutMs,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        ...extraEnv,
        LLXPRT_CODE_WELCOME_CONFIG_PATH: welcomeConfigPath,
      },
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

  // @plan PLAN-20260824-ISSUE2021.P06 @requirement REQ-2021.6: keyboard approval variants (deny, escape,
  // always-allow, multi-call pending, long-output-then-approval) as real-TTY flows.
  runTmuxE2E(
    'tool approval dialog denial via keyboard cancels the call and ends the turn',
    () => {
      const result = runHarness(
        'tmux-script.approval-deny.json',
        'approval-deny',
        [],
        {
          LLXPRT_FAKE_RESPONSES: path.join(
            projectRoot,
            'scripts/fixtures/approval-deny.responses.jsonl',
          ),
        },
      );
      assertHarnessSuccess(result);
    },
    300_000,
  );

  runTmuxE2E(
    'escape mid-dialog cancels the pending approval and ends the turn',
    () => {
      const result = runHarness(
        'tmux-script.approval-escape.json',
        'approval-escape',
        [],
        {
          LLXPRT_FAKE_RESPONSES: path.join(
            projectRoot,
            'scripts/fixtures/approval-deny.responses.jsonl',
          ),
        },
      );
      assertHarnessSuccess(result);
    },
    300_000,
  );

  runTmuxE2E(
    'always-allow auto-approves the pending sibling and later matching calls without a new dialog',
    () => {
      const result = runHarness(
        'tmux-script.approval-always.json',
        'approval-always',
        [],
        {
          LLXPRT_FAKE_RESPONSES: path.join(
            projectRoot,
            'scripts/fixtures/approval-always.responses.jsonl',
          ),
        },
      );
      assertHarnessSuccess(result);
    },
    300_000,
  );

  runTmuxE2E(
    'successive tool calls surface separate approval dialogs and both execute',
    () => {
      const result = runHarness(
        'tmux-script.approval-multi.json',
        'approval-multi',
        [],
        {
          LLXPRT_FAKE_RESPONSES: path.join(
            projectRoot,
            'scripts/fixtures/approval-multi.responses.jsonl',
          ),
        },
      );
      assertHarnessSuccess(result);
    },
    300_000,
  );

  runTmuxE2E(
    'long tool output renders and the following approval dialog stays answerable',
    () => {
      const result = runHarness(
        'tmux-script.approval-long-output.json',
        'approval-long-output',
        [],
        {
          LLXPRT_FAKE_RESPONSES: path.join(
            projectRoot,
            'scripts/fixtures/approval-long-output.responses.jsonl',
          ),
        },
      );
      assertHarnessSuccess(result);
    },
    300_000,
  );

  runTmuxE2E(
    'a clean welcome config shows onboarding, and skipping dismisses it',
    () => {
      // The startCommand inside scripts/tmux-script.onboarding.json — not this
      // test — sets LLXPRT_CODE_WELCOME_CONFIG_PATH to a per-run temp path and
      // removes it before launch, so the CLI starts as a first-run/clean
      // runner. Editing that scenario to point at a completed config instead
      // makes it fail on the first waitFor, which is what makes this smoke
      // meaningful rather than vacuous.
      const result = runHarness(
        'tmux-script.onboarding.json',
        'onboarding-clean-runner',
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

  runTmuxE2E(
    'startup composer renders deterministically and quits cleanly',
    () => {
      const result = runHarness(
        'tmux-script.issue2016-composer.fake.json',
        'issue2016-composer',
      );
      assertHarnessSuccess(result);
    },
    300_000,
  );

  runTmuxE2E(
    'keeps post-clear memory bounded after sustained standard-buffer output',
    () => {
      const testName = 'issue3386-memory-retention';
      const artifactDir = getArtifactDir(testName);
      const result = runHarness(
        'tmux-script.issue3386-memory-retention.fake.json',
        testName,
        [],
        { LLXPRT_TMUX_ARTIFACT_DIR: artifactDir },
        600_000,
      );
      assertHarnessSuccess(result);

      const samples = parseSamples(
        readFileSync(
          path.join(artifactDir, 'memprofile', 'samples.jsonl'),
          'utf8',
        ),
      );
      assertBoundedPostClearRetention(samples);
    },
    600_000,
  );

  runTmuxE2E(
    'provider and model dialogs work with the fake provider',
    () => {
      const result = runHarness(
        'tmux-script.provider-model.json',
        'provider-model',
      );
      assertHarnessSuccess(result);
    },
    300_000,
  );

  runTmuxE2E(
    'welcome onboarding skips from isolated clean state',
    () => {
      const testName = 'welcome';
      const result = runHarness(
        'tmux-script.welcome.json',
        testName,
        [],
        {},
        300_000,
        'clean',
      );
      assertHarnessSuccess(result);

      const savedState: unknown = JSON.parse(
        readFileSync(
          path.join(getArtifactDir(testName), 'welcome-config.json'),
          'utf8',
        ),
      );
      expect(savedState).toMatchObject({
        welcomeCompleted: true,
        skipped: true,
      });
    },
    300_000,
  );

  runTmuxE2E(
    'session browser reflows across real terminal resizes',
    () => {
      const result = runHarness(
        'tmux-script.session-browser-resize.json',
        'session-browser-resize',
      );
      assertHarnessSuccess(result);
    },
    300_000,
  );

  runTmuxE2E(
    'composer preserves Unicode and wide characters while wrapping',
    () => {
      const result = runHarness(
        'tmux-script.unicode-composer.json',
        'unicode-composer',
      );
      assertHarnessSuccess(result);
    },
    300_000,
  );

  runTmuxE2E(
    'session browser opens, navigates, sorts, searches, and closes',
    () => {
      const result = runHarness(
        'tmux-script.session-browser.json',
        'session-browser-navigation',
        [],
        {
          LLXPRT_FAKE_RESPONSES: path.join(
            projectRoot,
            'scripts/fixtures/session-browser.responses.jsonl',
          ),
        },
      );
      assertHarnessSuccess(result);
    },
    300_000,
  );
});
