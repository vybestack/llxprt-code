/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scenario execution and assertion logic extracted from tmux-harness.ts
 * to satisfy the 800line file-size limit. Private to the tmux-harness subsystem.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { sanitizeLabel } from './tmux-harness-helpers.ts';
import {
  runTmux,
  tryTmux,
  sleep,
  captureScreen,
  captureScrollback,
  captureArtifacts,
  getHistorySize,
  getTmuxSocketPath,
} from './tmux-harness-io.ts';

export interface ScenarioResult {
  kind: string;
  sentinel?: string;
  historySamples?: Array<{ tMs: number; historySize: number }>;
  captures?: { screenFile: string; scrollbackFile: string };
}

export type TypeLineAndSubmitFn = (
  line: string,
  opts?: TypeLineSubmitOptions,
) => Promise<void>;

export interface TypeLineSubmitOptions {
  postTypeMs?: number;
  enterRepeats?: number;
  escapeBeforeEnter?: boolean;
}

export async function runScenarioHaiku({
  typeLineAndSubmit,
}: {
  typeLineAndSubmit: TypeLineAndSubmitFn;
  sessionName: string;
}): Promise<{ kind: string }> {
  await typeLineAndSubmit('/profile load synthetic');
  await sleep(2000);

  await typeLineAndSubmit('write me a haiku');
  await sleep(8000);

  await typeLineAndSubmit('/quit', { enterRepeats: 1 });

  return { kind: 'haiku' };
}

interface ScenarioScrollbackParams {
  sessionName: string;
  typeLineAndSubmit: TypeLineAndSubmitFn;
  outDir: string;
}

export async function runScenarioScrollback({
  sessionName,
  typeLineAndSubmit,
  outDir,
}: ScenarioScrollbackParams): Promise<{
  kind: string;
  sentinel: string;
  historySamples: Array<{ tMs: number; historySize: number }>;
  captures: { screenFile: string; scrollbackFile: string };
}> {
  await typeLineAndSubmit('/profile load synthetic');
  await sleep(2000);

  const sentinel = 'SCROLLTEST LINE';

  const cmd = '!bun scripts/scrollback-load.ts --total 60 --interval-ms 250';
  await typeLineAndSubmit(cmd, { enterRepeats: 1, escapeBeforeEnter: false });

  await sleep(600);
  const maybeDialog = captureScreen(sessionName);
  if (maybeDialog.includes('Shell Command Execution')) {
    runTmux(['send-keys', '-t', sessionName, 'Enter']);
  }

  await sleep(800);
  runTmux(['send-keys', '-t', sessionName, 'C-s']);

  await sleep(2500);
  runTmux(['copy-mode', '-t', `${sessionName}:0.0`]);
  for (let i = 0; i < 3; i += 1) {
    runTmux(['send-keys', '-t', `${sessionName}:0.0`, '-X', 'page-up']);
  }

  const sampleStart = Date.now();
  const historySamples = [];
  const sampleForMs = 20000;
  while (Date.now() - sampleStart <= sampleForMs) {
    historySamples.push({
      tMs: Date.now() - sampleStart,
      historySize: getHistorySize(sessionName),
    });
    await sleep(1000);
  }

  runTmux(['send-keys', '-t', `${sessionName}:0.0`, '-X', 'cancel']);

  await sleep(2000);

  const preExitScreen = captureScreen(sessionName);
  const preExitScrollback = captureScrollback(sessionName, 20000);
  await fs.writeFile(
    path.join(outDir, 'during-run-screen.txt'),
    preExitScreen,
    'utf8',
  );
  await fs.writeFile(
    path.join(outDir, 'during-run-scrollback.txt'),
    preExitScrollback,
    'utf8',
  );

  await typeLineAndSubmit('/quit', { enterRepeats: 1 });

  await fs.writeFile(
    path.join(outDir, 'history-samples.json'),
    JSON.stringify(historySamples, null, 2),
    'utf8',
  );

  return {
    kind: 'scrollback',
    sentinel,
    historySamples,
    captures: {
      screenFile: 'during-run-screen.txt',
      scrollbackFile: 'during-run-scrollback.txt',
    },
  };
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

interface AssertScrollbackParams {
  scenarioResult: {
    sentinel: string;
    historySamples: Array<{ tMs: number; historySize: number }>;
    captures?: { screenFile: string; scrollbackFile: string };
  };
  baselineScrollback: string;
  assert: boolean;
  outDir: string;
  tmuxConfig: { cols: number; rows: number };
}

export async function assertScrollbackResults({
  scenarioResult,
  baselineScrollback,
  assert,
  outDir,
  tmuxConfig,
}: AssertScrollbackParams): Promise<Error | null> {
  const sentinelCount =
    baselineScrollback.match(new RegExp(scenarioResult.sentinel, 'g'))
      ?.length ?? 0;
  const tipsCount =
    baselineScrollback.match(/Tips for getting started:/g)?.length ?? 0;

  const historyDelta =
    scenarioResult.historySamples.length >= 2
      ? (scenarioResult.historySamples.at(-1)?.historySize ?? 0) -
        scenarioResult.historySamples[0].historySize
      : 0;

  await fs.writeFile(
    path.join(outDir, 'metrics.json'),
    JSON.stringify(
      {
        scenario: 'scrollback',
        tmux: {
          cols: tmuxConfig.cols,
          rows: tmuxConfig.rows,
        },
        counts: {
          sentinel: scenarioResult.sentinel,
          sentinelCount,
          tipsCount,
        },
        history: {
          deltaDuringCopyMode: historyDelta,
          samplesFile: 'history-samples.json',
        },
        captures: scenarioResult.captures ?? null,
      },
      null,
      2,
    ),
    'utf8',
  );

  if (!assert) return null;

  if (sentinelCount < 1) {
    return new Error(
      `Scrollback output missing: expected sentinelCount >= 1 but got ${sentinelCount} (sentinel: "${scenarioResult.sentinel}")`,
    );
  }
  if (historyDelta !== 0) {
    return new Error(
      `Scrollback redraw detected: expected history delta == 0 but got ${historyDelta}`,
    );
  }
  if (tipsCount > 1) {
    return new Error(
      `Scrollback redraw detected: expected tipsCount <= 1 but got ${tipsCount}`,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Script steps runner
// ---------------------------------------------------------------------------

interface RunScriptStepsParams {
  sessionName: string;
  outDir: string;
  steps: unknown[];
  defaults: {
    postTypeMs: number;
    submitKeys: string[];
    shellSubmitKeys: string[];
    timeoutMs: number;
    pollMs: number;
    scrollbackLines: number;
  };
}

export async function runScriptSteps({
  sessionName,
  outDir,
  steps,
  defaults,
}: RunScriptStepsParams): Promise<void> {
  const scriptState: {
    historySamples: Array<{
      tMs: number;
      historySize: number;
      label: string;
    }>;
  } = {
    historySamples: [],
  };

  const sendKeys = async (keys: string[]): Promise<void> => {
    for (const key of keys) {
      runTmux(['send-keys', '-t', sessionName, key]);
      await sleep(120);
    }
  };

  // Imported lazily to avoid a circular dependency at module load time:
  // tmux-harness-steps imports from tmux-harness-io which is fine, but
  // keeping this dynamic import here mirrors the original structure and
  // prevents the harness entry point from pulling in step execution
  // unless it is actually running a script scenario.
  const { executeStepDispatch } = await import('./tmux-harness-steps.ts');

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      throw new Error(`Invalid step at index ${i}: ${JSON.stringify(step)}`);
    }
    const stepRecord = Object.fromEntries(Object.entries(step));

    try {
      await executeStepDispatch(stepRecord, i, {
        sessionName,
        outDir,
        sendKeys,
        scriptState,
        defaults,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stepLabel = sanitizeLabel(
        `${String(i).padStart(3, '0')}-error-${stepRecord.type ?? 'unknown'}`,
      );
      const scrollbackLines = Number(defaults.scrollbackLines);
      await captureArtifacts({
        sessionName,
        outDir,
        label: stepLabel,
        scrollbackLines,
      });
      await fs.writeFile(
        path.join(outDir, `${stepLabel}-step.json`),
        JSON.stringify({ index: i, step, error: message }, null, 2),
        'utf8',
      );
      throw error;
    }
  }

  if (scriptState.historySamples.length > 0) {
    await fs.writeFile(
      path.join(outDir, 'history-samples.json'),
      JSON.stringify(scriptState.historySamples, null, 2),
      'utf8',
    );
  }
}

// ---------------------------------------------------------------------------
// Teardown helpers
// ---------------------------------------------------------------------------

interface HandleScenarioErrorParams {
  error: unknown;
  sessionName: string;
  outDir: string;
  scrollbackLines: number | undefined;
  keepSession: boolean;
  scriptSteps: unknown[] | undefined;
  scenario: string;
}

export async function handleScenarioError({
  error,
  sessionName,
  outDir,
  scrollbackLines,
  keepSession,
  scriptSteps,
  scenario,
}: HandleScenarioErrorParams): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const resolvedScrollbackLines = scrollbackLines ?? 2000;
  try {
    await captureArtifacts({
      sessionName,
      outDir,
      label: 'error-final',
      scrollbackLines: resolvedScrollbackLines,
    });
  } catch {
    // ignore
  }
  try {
    await fs.writeFile(
      path.join(outDir, 'error.json'),
      JSON.stringify({ message }, null, 2),
      'utf8',
    );
  } catch {
    // ignore
  }
  if (!keepSession) {
    tryTmux(['kill-session', '-t', sessionName]);
  }
  console.error(
    [
      `tmux session: ${sessionName}`,
      ...(keepSession ? [`tmux socket: ${getTmuxSocketPath()}`] : []),
      `artifacts: ${outDir}`,
      `scenario: ${scriptSteps ? 'script' : scenario}`,
    ].join('\n'),
  );
}

interface CaptureFinalArtifactsParams {
  sessionName: string;
  outDir: string;
  scenario: string;
  scrollbackLines: number;
}

export async function captureFinalArtifacts({
  sessionName,
  outDir,
  scenario,
  scrollbackLines,
}: CaptureFinalArtifactsParams): Promise<{
  screen: string;
  scrollback: string;
  resolvedScrollbackLines: number;
}> {
  const screen = captureScreen(sessionName);
  const resolvedScrollbackLines =
    scenario === 'scrollback' ? 20000 : scrollbackLines;
  const scrollback = captureScrollback(sessionName, resolvedScrollbackLines);
  await fs.writeFile(path.join(outDir, 'screen.txt'), screen, 'utf8');
  await fs.writeFile(path.join(outDir, 'scrollback.txt'), scrollback, 'utf8');
  return { screen, scrollback, resolvedScrollbackLines };
}
