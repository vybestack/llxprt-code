/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const scenarioPath = resolve(
  repoRoot,
  'scripts/tmux-script.issue3386-memory-retention.fake.json',
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireRecords(
  value: unknown,
  label: string,
): ReadonlyArray<Record<string, unknown>> {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`${label} must be an array of objects`);
  }
  return value;
}

function requireStrings(value: unknown, label: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw new Error(`${label} must be a number`);
  }
  return value;
}

function loadScenario(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(scenarioPath, 'utf8'));
  return requireRecord(parsed, 'scenario');
}

function lineTexts(
  steps: ReadonlyArray<Record<string, unknown>>,
): readonly string[] {
  return steps.flatMap((step) =>
    step['type'] === 'line' && typeof step['text'] === 'string'
      ? [step['text']]
      : [],
  );
}

function findStepIndex(
  steps: ReadonlyArray<Record<string, unknown>>,
  predicate: (step: Record<string, unknown>) => boolean,
): number {
  return steps.findIndex(predicate);
}

describe('issue #3386 tmux memory-retention workload', () => {
  it('starts the source profiler with fixed local-only launch settings and harness-rooted artifacts', () => {
    const scenario = loadScenario();
    const tmux = requireRecord(scenario['tmux'], 'scenario.tmux');
    const startCommand = requireStrings(
      scenario['startCommand'],
      'scenario.startCommand',
    );

    expect(requireNumber(tmux['cols'], 'tmux.cols')).toBe(120);
    expect(requireNumber(tmux['rows'], 'tmux.rows')).toBe(40);
    expect(startCommand.slice(0, 2)).toEqual(['/bin/sh', '-c']);
    expect(startCommand).toHaveLength(3);
    const shellCommand = startCommand[2] ?? '';
    expect(shellCommand).toContain(
      '${bun} scripts/memory/launcher.ts --dir "$LLXPRT_TMUX_ARTIFACT_DIR/memprofile"',
    );
    expect(shellCommand).toContain('--interval 86400000 --');
    expect(shellCommand).toContain('NO_COLOR=true FORCE_COLOR=0');
    expect(shellCommand).not.toContain('--snapshots');
    expect(shellCommand).toContain('--provider fake --model fake-model');
    expect(shellCommand).toContain(
      'LLXPRT_FAKE_RESPONSES=scripts/fixtures/issue2208-newlines.responses.jsonl',
    );
    expect(shellCommand).toContain(
      'LLXPRT_SYSTEM_SETTINGS_PATH=scripts/system-settings.interactive-ui.json',
    );
    expect(shellCommand).toContain(
      'LLXPRT_CODE_WELCOME_CONFIG_PATH=scripts/fixtures/welcome-completed.json',
    );
    expect(shellCommand).toContain('--yolo');
  });

  it('orders three forced-GC checkpoints around four distinct cache-exceeding shell workloads, clear, and clean exit', () => {
    const scenario = loadScenario();
    const steps = requireRecords(scenario['steps'], 'scenario.steps');
    const lines = lineTexts(steps);
    const requestCommand =
      'bun scripts/memory/request-cli.ts --dir "$LLXPRT_TMUX_ARTIFACT_DIR/memprofile" --wait';
    const requestStepIndexes = steps.flatMap((step, index) =>
      step['type'] === 'line' && step['text'] === requestCommand ? [index] : [],
    );
    const generatorPattern =
      /^bun scripts\/memory\/output-generator\.ts --seed ([A-Za-z0-9_-]+) --lines ([1-9]\d*) --width ([1-9]\d*)$/;
    const generatorCalls = lines.flatMap((line) => {
      const match = line.match(generatorPattern);
      const seed = match?.[1];
      const lineCount = match?.[2];
      const lineWidth = match?.[3];
      return seed !== undefined &&
        lineCount !== undefined &&
        lineWidth !== undefined
        ? [
            {
              line,
              seed,
              lineCount: Number(lineCount),
              lineWidth: Number(lineWidth),
            },
          ]
        : [];
    });
    const generatorStepIndexes = generatorCalls.map((call) =>
      findStepIndex(
        steps,
        (step) => step['type'] === 'line' && step['text'] === call.line,
      ),
    );
    const requestPromptIndexes = requestStepIndexes.map((index) => {
      const shellPrompt = steps[index + 1];
      expect(shellPrompt).toMatchObject({
        type: 'waitFor',
        scope: 'screen',
        contains: 'Type your shell command',
      });
      return index + 1;
    });
    const generatorPromptIndexes = generatorStepIndexes.map((index) => {
      const fixedWait = steps[index + 1];
      const shellPrompt = steps[index + 2];

      expect(fixedWait?.['type']).toBe('wait');
      expect(
        requireNumber(fixedWait?.['ms'], 'completion wait.ms'),
      ).toBeGreaterThanOrEqual(10_000);
      expect(shellPrompt).toMatchObject({
        type: 'waitFor',
        scope: 'screen',
        contains: 'Type your shell command',
      });
      return index + 2;
    });

    expect(requestStepIndexes).toHaveLength(3);
    expect(
      lines.filter((line) => line.includes('scripts/memory/request-cli.ts')),
    ).toEqual([requestCommand, requestCommand, requestCommand]);
    expect(
      steps.filter(
        (step) =>
          step['type'] === 'waitFor' &&
          typeof step['contains'] === 'string' &&
          step['contains'].startsWith('LLXPRT3386_'),
      ),
    ).toEqual([]);
    expect(generatorCalls.length).toBeGreaterThanOrEqual(4);
    expect(new Set(generatorCalls.map((call) => call.seed)).size).toBe(
      generatorCalls.length,
    );
    expect(
      generatorCalls.reduce(
        (total, call) => total + call.lineCount * call.lineWidth,
        0,
      ),
    ).toBeGreaterThan(4 * 1024 * 1024);

    const firstGenerator = generatorStepIndexes[0] ?? -1;
    const lastGeneratorPrompt = generatorPromptIndexes.at(-1) ?? -1;
    const clear = findStepIndex(
      steps,
      (step) => step['type'] === 'line' && step['text'] === '/clear',
    );
    const promptAfterClear = steps.findIndex(
      (step, index) =>
        index > clear &&
        step['type'] === 'waitFor' &&
        step['contains'] === 'Type your message',
    );
    const quit = findStepIndex(
      steps,
      (step) => step['type'] === 'line' && step['text'] === '/quit',
    );
    const waitForExit = findStepIndex(
      steps,
      (step) => step['type'] === 'waitForExit',
    );

    expect(requestStepIndexes[0]).toBeLessThan(firstGenerator);
    expect(requestPromptIndexes[0]).toBeLessThan(firstGenerator);
    expect(requestStepIndexes[1]).toBeGreaterThan(lastGeneratorPrompt);
    expect(clear).toBeGreaterThan(requestPromptIndexes[1] ?? -1);
    expect(promptAfterClear).toBeGreaterThan(clear);
    expect(requestStepIndexes[2]).toBeGreaterThan(promptAfterClear);
    expect(quit).toBeGreaterThan(requestPromptIndexes[2] ?? -1);
    expect(waitForExit).toBe(steps.length - 1);
    expect(waitForExit).toBeGreaterThan(quit);
  });
});
