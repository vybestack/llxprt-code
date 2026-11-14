/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4084: the real-model tmux scenarios A-I are run in Phase E. These
 * tests load every scenario script through the harness's own script helpers
 * (macro expansion, start-argument building, matcher compilation) without
 * starting tmux or a model, and check the shape each scenario needs: the
 * lunahigh profile, the code mode setting, a capture after every action, and
 * `/stats` before `/quit`. The scenario H subagent setup script is exercised
 * against a temporary config directory.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildStartArgs,
  compileMatcher,
  expandScriptMacros,
} from '../tmux-harness.ts';
import { writeCodeModeSubagents } from '../issue4084-subagent-setup.ts';

const SCRIPTS_DIR = path.resolve(import.meta.dir, '..');

/** Step types `executeStepDispatch` handles. */
const STEP_TYPES = new Set([
  'wait',
  'resize',
  'line',
  'key',
  'keys',
  'selectToolOption',
  'copyMode',
  'capture',
  'waitFor',
  'waitForNot',
  'expect',
  'expectCount',
  'approveShell',
  'approveTool',
  'historySample',
  'expectHistoryDelta',
  'waitForExit',
]);
const ACTION_TYPES = new Set(['line', 'key', 'keys', 'approveTool']);

interface ScenarioStep {
  readonly type: string;
  readonly text?: string;
  readonly key?: string;
  readonly choice?: string;
  readonly contains?: string;
  readonly regex?: string;
  readonly scope?: string;
}

interface Scenario {
  readonly yolo: boolean;
  readonly startCommand: string[];
  readonly steps: ScenarioStep[];
  readonly macros?: Record<string, unknown[]>;
}

const EXPECTED = [
  'a-plans-off',
  'a-plans-on',
  'b-longest-off',
  'b-longest-on',
  'c-unprompted-on',
  'd-read-off',
  'd-read-on',
  'e-approve-deny-on',
  'f-escape-on',
  'g-escape-attempts-on',
  'h1-parent-on',
  'h2-subagent-off',
  'h3-subagent-on',
  'i-large-output-on',
  'nested-approval',
];

function scenarioFiles(): string[] {
  return readdirSync(SCRIPTS_DIR)
    .filter(
      (file) =>
        file.startsWith('tmux-script.issue4084-') &&
        file.endsWith('.llxprt.json'),
    )
    .sort();
}

function load(file: string): Scenario {
  const raw = JSON.parse(
    readFileSync(path.join(SCRIPTS_DIR, file), 'utf8'),
  ) as Scenario;
  return {
    ...raw,
    steps: expandScriptMacros(raw.steps, raw.macros) as ScenarioStep[],
  };
}

function nameOf(file: string): string {
  return file.slice('tmux-script.issue4084-'.length, -'.llxprt.json'.length);
}

/** The code mode value the scenario starts the parent with. */
function expectedMode(name: string): 'on' | 'off' {
  if (name.startsWith('h2-') || name.startsWith('h3-')) return 'off';
  return name.endsWith('-off') ? 'off' : 'on';
}

describe('issue4084 tmux scenario scripts', () => {
  it('has one script for every scratch test and before/after pair', () => {
    expect(scenarioFiles().map(nameOf)).toStrictEqual([...EXPECTED].sort());
  });

  it.each(EXPECTED.map((name) => [name]))(
    '%s loads through the harness helpers with valid steps and matchers',
    (name) => {
      const scenario = load(`tmux-script.issue4084-${name}.llxprt.json`);
      const args = buildStartArgs(scenario, scenario.yolo);

      expect(args.slice(0, 4)).toStrictEqual([
        'bun',
        'scripts/start.ts',
        '--profile-load',
        'lunahigh',
      ]);
      expect(args).toContain(`code-mode=${expectedMode(name)}`);
      expect(args[args.indexOf(`code-mode=${expectedMode(name)}`) - 1]).toBe(
        '--set',
      );
      for (const step of scenario.steps) {
        expect(STEP_TYPES.has(step.type)).toBe(true);
        if (step.contains !== undefined || step.regex !== undefined)
          expect(() => compileMatcher(step)).not.toThrow();
      }
    },
  );

  it.each(EXPECTED.map((name) => [name]))(
    '%s captures screen and scrollback after each action and ends with /stats then /quit',
    (name) => {
      const { steps } = load(`tmux-script.issue4084-${name}.llxprt.json`);
      const actions = steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => ACTION_TYPES.has(step.type));
      for (const { step, index } of actions) {
        if (step.text === '/quit') continue;
        const next = steps
          .slice(index + 1)
          .find(
            (later) => later.type === 'capture' || ACTION_TYPES.has(later.type),
          );
        expect(next?.type).toBe('capture');
        expect(next?.scope).toBeUndefined();
      }
      const texts = steps.map((step) => step.text);
      const stats = texts.lastIndexOf('/stats');
      const quit = texts.lastIndexOf('/quit');
      expect(stats).toBeGreaterThan(0);
      expect(quit).toBeGreaterThan(stats);
      expect(steps[steps.length - 1].type).toBe('waitForExit');
    },
  );

  it('runs E without yolo, approving the first nested prompt and denying the second', () => {
    const scenario = load(
      'tmux-script.issue4084-e-approve-deny-on.llxprt.json',
    );
    const choices = scenario.steps
      .filter((step) => step.type === 'approveTool')
      .map((step) => step.choice);

    expect(scenario.yolo).toBe(false);
    expect(buildStartArgs(scenario, scenario.yolo)).not.toContain('--yolo');
    expect(choices).toStrictEqual(['once', 'no']);
  });

  it('presses Escape in F once the nested call runs, then checks processes in shell mode', () => {
    const { steps } = load('tmux-script.issue4084-f-escape-on.llxprt.json');
    const nestedStarted = steps.findIndex(
      (step) => step.type === 'waitFor' && step.contains === 'from script:',
    );
    const escape = steps.findIndex(
      (step) => step.type === 'key' && step.key === 'Escape',
    );
    const ps = steps.findIndex(
      (step) => step.type === 'line' && step.text?.startsWith('!ps ') === true,
    );

    expect(nestedStarted).toBeGreaterThan(0);
    expect(escape).toBeGreaterThan(nestedStarted);
    expect(ps).toBeGreaterThan(escape);
    expect(steps[ps].text).toContain('quickjs-wrapper');
  });

  it('delegates H2 and H3 to the off and on gatherer subagents', () => {
    const goal = (name: string) =>
      load(`tmux-script.issue4084-${name}.llxprt.json`).steps.find(
        (step) => step.type === 'line',
      )?.text;

    expect(goal('h2-subagent-off')).toContain('issue4084-gatherer-off');
    expect(goal('h3-subagent-on')).toContain('issue4084-gatherer-on');
  });
});

describe('issue4084 subagent setup', () => {
  const configDir = mkdtempSync(path.join(tmpdir(), 'issue4084-setup-'));
  afterAll(() => rmSync(configDir, { recursive: true, force: true }));

  it('writes off and on profiles from the base profile and a gatherer for each', () => {
    mkdirSync(path.join(configDir, 'profiles'), { recursive: true });
    writeFileSync(
      path.join(configDir, 'profiles', 'haiku.json'),
      JSON.stringify({
        version: 1,
        provider: 'anthropic',
        model: 'claude-haiku',
        modelParams: {},
        ephemeralSettings: { 'context-limit': 1000 },
      }),
    );
    const result = writeCodeModeSubagents(configDir, 'haiku');
    const read = (...parts: string[]) =>
      JSON.parse(readFileSync(path.join(configDir, ...parts), 'utf8')) as {
        ephemeralSettings?: Record<string, unknown>;
        profile?: string;
        model?: string;
      };

    expect(result.subagents).toStrictEqual([
      'issue4084-gatherer-off',
      'issue4084-gatherer-on',
    ]);
    for (const mode of ['off', 'on']) {
      const profile = read('profiles', `issue4084-haiku-code-${mode}.json`);
      expect(profile.model).toBe('claude-haiku');
      expect(profile.ephemeralSettings).toStrictEqual({
        'context-limit': 1000,
        'code-mode': mode,
      });
      expect(read('subagents', `issue4084-gatherer-${mode}.json`).profile).toBe(
        `issue4084-haiku-code-${mode}`,
      );
    }
  });
});
