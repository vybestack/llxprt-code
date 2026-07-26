/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { isDestructiveCommand } from '@vybestack/llxprt-code-policy';

describe('CodeQL js/polynomial-redos: dd of= linear scan preserves credential detection', () => {
  it.each<[string, boolean]>([
    ['dd of=$HOME/.ssh/authorized_keys', true],
    ['dd of=$(echo ~/.ssh/authorized_keys)', true],
    ['dd of=$(cat ~/.aws/credentials)', true],
    ['dd of=$(cat ~/.config/gh/hosts.yml)', true],
    ['dd of=$HOME/.aws/credentials', true],
    ['dd of=$HOME/.config/git/credentials', true],
    ['dd of=/dev/null', false],
    ['dd of=./disk.img', false],
    ['dd of=~/notes.bin', false],
    ['dd if=/dev/zero of=./disk.img', false],
    ['dd if=/dev/zero bs=1M', false],
    ['dd of=', false],
  ])('dd "%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });

  it('detects command-substitution of= with interior spaces', () => {
    expect(
      isDestructiveCommand('dd of=$( printf "%s" ~/.ssh/authorized_keys )'),
    ).toBe(true);
  });

  it('respects the whitespace/start boundary: xof= is not an of= operand', () => {
    expect(isDestructiveCommand('dd xof=$HOME/.ssh/authorized_keys')).toBe(
      false,
    );
    expect(isDestructiveCommand('dd of=$HOME/.ssh/authorized_keys')).toBe(true);
  });

  it('completes a pathological of= input well within a strict time budget (no ReDoS hang)', () => {
    // Many "of=$(...)" operands is the adversarial shape the CodeQL alert
    // flags: the old regex alternation `\$\([^)]*\)|\S+` backtracks across
    // each whitespace-delimited of= prefix. The linear scan must parse every
    // operand in a single left-to-right pass. Balanced parens keep the
    // substitution extractor bounded so the timing isolates the of= scan.
    const repetitions = 20_000;
    const pathological = ' of=$(x)'.repeat(repetitions);
    const deadline = 200; // ms — a linear scan of ~160KB finishes far below this
    const start = performance.now();
    isDestructiveCommand(`dd${pathological}`);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(deadline);
  });
});
