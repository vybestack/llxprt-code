/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as child_process from 'child_process';
import { preflightSteps, runPreflight } from '../preflight-ci.js';

vi.mock('child_process');

/**
 * Issue #2323: Behavioral regression test for release preflight step ordering.
 *
 * The nightly release failed because preflight-ci.js ran `npm run test:ci`
 * without first generating the agents API-surface report
 * (`node_modules/.cache/agents-api-surface/report.json`). The agents package
 * surface guard test fails closed when that report is absent, which aborted
 * the release. These tests lock the contract that preflight generates the
 * report before running the test suite, so the ordering cannot silently
 * regress.
 */
describe('Issue #2323: preflight-ci step ordering', () => {
  const steps = preflightSteps();
  const commands = steps.map((step) => step.command);

  it('runs lint:agents-api-surface during preflight', () => {
    expect(commands).toContain('npm run lint:agents-api-surface');
  });

  it('runs lint:agents-api-surface before test:ci', () => {
    const surfaceIndex = commands.indexOf('npm run lint:agents-api-surface');
    const testIndex = commands.indexOf('npm run test:ci');
    expect(surfaceIndex).toBeGreaterThan(-1);
    expect(testIndex).toBeGreaterThan(-1);
    expect(surfaceIndex).toBeLessThan(testIndex);
  });

  it('keeps build, typecheck, and test:ci in their established order', () => {
    const buildIndex = commands.indexOf('npm run build');
    const typecheckIndex = commands.indexOf('npm run typecheck');
    const testIndex = commands.indexOf('npm run test:ci');
    expect(buildIndex).toBeGreaterThan(-1);
    expect(typecheckIndex).toBeGreaterThan(buildIndex);
    expect(testIndex).toBeGreaterThan(typecheckIndex);
  });
});

describe('Issue #2323: root package.json preflight script', () => {
  it('uses the shared preflight-ci runner', () => {
    const rootManifest = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '..', '..', 'package.json'),
        'utf8',
      ),
    );
    const preflightScript = rootManifest.scripts.preflight;
    expect(
      preflightScript,
      'root package.json must define a scripts.preflight entry for CI release preflight',
    ).toEqual(expect.any(String));
    expect(preflightScript).toBe('node scripts/preflight-ci.js');
  });
});

/**
 * Issue #2323: Behavioral coverage for runPreflight() execution order.
 *
 * preflightSteps() is verified in isolation above, but nothing previously
 * asserted that runPreflight() actually drives the step sequence through
 * child_process. This test runs the real runPreflight() with execSync mocked
 * at the infrastructure boundary so no real shell commands execute, and
 * verifies the preflightSteps() commands are dispatched in their defined
 * relative order, including lint:agents-api-surface before test:ci.
 */
describe('Issue #2323: runPreflight executes steps in order', () => {
  beforeEach(() => {
    vi.mocked(child_process.execSync).mockImplementation(() => Buffer.from(''));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches the preflightSteps() commands through child_process in order', () => {
    runPreflight();

    const calls = vi.mocked(child_process.execSync).mock.calls;
    const executedCommands = calls.map((call) => call[0]);
    const expectedCommands = preflightSteps().map((step) => step.command);

    for (const command of expectedCommands) {
      expect(
        executedCommands,
        `${command} must be dispatched by runPreflight()`,
      ).toContain(command);
    }

    for (let index = 0; index < expectedCommands.length - 1; index += 1) {
      const currentIndex = executedCommands.indexOf(expectedCommands[index]);
      const nextIndex = executedCommands.indexOf(expectedCommands[index + 1]);
      expect(currentIndex).toBeLessThan(nextIndex);
    }
  });

  it('continues through ordered preflight steps when rollup install fails', () => {
    const rollupCommand = 'npm install @rollup/rollup-linux-x64-gnu --no-save';
    vi.mocked(child_process.execSync).mockImplementation((command) => {
      if (command === rollupCommand) {
        throw new Error(`boom: ${command}`);
      }
      return Buffer.from('');
    });

    expect(() => runPreflight()).not.toThrow();

    const executedCommands = vi
      .mocked(child_process.execSync)
      .mock.calls.map((call) => call[0]);
    expect(executedCommands).toContain(rollupCommand);
    for (const step of preflightSteps()) {
      expect(
        executedCommands,
        `${step.command} must still run after rollup install fails`,
      ).toContain(step.command);
    }
  });
});
/**
 * Issue #2323: Behavioral coverage for abort-on-failure.
 *
 * runPreflight() must abort on the first failing critical command and must
 * not dispatch any subsequent steps. A failure in `npm run build` (run before
 * typecheck, lint:agents-api-surface, and test:ci) must surface a clear error
 * message naming the failed command and must short-circuit the remaining
 * steps so no later commands run.
 */
describe('Issue #2323: runPreflight aborts on failure', () => {
  beforeEach(() => {
    vi.mocked(child_process.execSync).mockImplementation(() => Buffer.from(''));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws Failed to run: npm run build and skips later steps', () => {
    const failingCommand = 'npm run build';
    vi.mocked(child_process.execSync).mockImplementation((command) => {
      if (command === failingCommand) {
        throw new Error(`boom: ${command}`);
      }
      return Buffer.from('');
    });

    expect(() => runPreflight()).toThrow(`Failed to run: ${failingCommand}`);

    const executedCommands = vi
      .mocked(child_process.execSync)
      .mock.calls.map((call) => call[0]);

    const buildIndex = executedCommands.indexOf(failingCommand);
    expect(
      buildIndex,
      'the failing build command must have been dispatched',
    ).toBeGreaterThan(-1);

    // Verify steps before build ran before the failure
    expect(executedCommands).toContain('npm run format');
    expect(executedCommands).toContain('npm run lint:ci');

    const commandsAfterBuild = executedCommands.slice(buildIndex + 1);
    const notAfterFailure = [
      'npm run typecheck',
      'npm run lint:agents-api-surface',
      'npm run test:ci',
    ];
    for (const command of notAfterFailure) {
      expect(
        commandsAfterBuild,
        `${command} must not run after ${failingCommand} fails`,
      ).not.toContain(command);
    }
  });
  it('throws Failed to run: npm run clean and skips all subsequent steps', () => {
    const failingCommand = 'npm run clean';
    vi.mocked(child_process.execSync).mockImplementation((command) => {
      if (command === failingCommand) {
        throw new Error(`boom: ${command}`);
      }
      return Buffer.from('');
    });

    expect(() => runPreflight()).toThrow(`Failed to run: ${failingCommand}`);

    const executedCommands = vi
      .mocked(child_process.execSync)
      .mock.calls.map((call) => call[0]);

    expect(executedCommands).not.toContain('npm ci');
    for (const step of preflightSteps()) {
      expect(
        executedCommands,
        `${step.command} must not run after ${failingCommand} fails`,
      ).not.toContain(step.command);
    }
  });
  it('throws Failed to run: npm ci and skips all ordered preflight steps', () => {
    const failingCommand = 'npm ci';
    vi.mocked(child_process.execSync).mockImplementation((command) => {
      if (command === failingCommand) {
        throw new Error(`boom: ${command}`);
      }
      return Buffer.from('');
    });

    expect(() => runPreflight()).toThrow(`Failed to run: ${failingCommand}`);

    const executedCommands = vi
      .mocked(child_process.execSync)
      .mock.calls.map((call) => call[0]);

    for (const step of preflightSteps()) {
      expect(
        executedCommands,
        `${step.command} must not run after ${failingCommand} fails`,
      ).not.toContain(step.command);
    }
  });
});
