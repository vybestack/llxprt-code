/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import script from '../tmux-script.issue3386-memory-retention.fake.json';
import { synchronizeShellInput } from './interactive-ui-input.ts';

describe('memory scenario shell input synchronization', () => {
  it('frames each command and waits for its composer echo before the original submit delay', () => {
    const synchronized = synchronizeShellInput(script);
    const commands = script.steps.filter((step) => step.type === 'line');
    expect(commands).toHaveLength(9);
    for (const command of commands) {
      const index = synchronized.steps.findIndex(
        (step) => step.keys?.[0] === `\x1b[200~${command.text}\x1b[201~`,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      const acknowledgement = synchronized.steps[index + 1];
      expect(acknowledgement?.type).toBe('waitFor');
      expect(acknowledgement?.scope).toBe('screen');
      if (acknowledgement?.regex === undefined || command.text === undefined)
        throw new Error('Missing composer acknowledgement');
      const matcher = new RegExp(acknowledgement.regex);
      expect(matcher.test(`│ ! ${command.text}`)).toBe(true);
      expect(matcher.test(`│ > ${command.text}`)).toBe(true);
      expect(matcher.test('│ !   Type your shell command')).toBe(false);
      expect(synchronized.steps[index + 2]).toStrictEqual({
        ...command,
        text: '',
      });
    }
    expect(synchronized.steps).toHaveLength(
      script.steps.length + commands.length * 2,
    );
    expect(synchronized.startCommand).toStrictEqual(script.startCommand);
  });

  it('preserves readiness, workload settling, memory checkpoints, and exit steps', () => {
    const synchronized = synchronizeShellInput(script);
    const remaining = script.steps.filter((step) => step.type !== 'line');
    expect(
      synchronized.steps.filter((step) =>
        remaining.some((original) => original === step),
      ),
    ).toStrictEqual(remaining);
    expect(script.steps.filter((step) => step.text === '')).toHaveLength(0);
  });
});
