/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { ladderAttempt } from './__tests__/support/source-compression-ladder-fixture.js';

const root = sourceRootSetup();
function receipt(name: string, value: unknown): void {
  const evidence = process.env.ISSUE854_COMPRESSION_EVIDENCE;
  if (evidence !== undefined)
    writeFileSync(
      join(evidence, `${name}-${process.pid}.json`),
      JSON.stringify(value, null, 2),
    );
}

function assertSourceSuccess(
  source: Awaited<ReturnType<typeof ladderAttempt>>,
): void {
  expect(source.activeBodies).toBe(0);
  expect(source.owners.every((owner) => owner.closed)).toBe(true);
  expect(source.error).toBeUndefined();
  expect(source.bodies).toHaveLength(1);
  expect(source.estimate?.estimatedPromptTokens).toBeLessThanOrEqual(
    3015 - 128,
  );
}

describe('required real disk compression HTTP parity with the unchanged array route', () => {
  it('compresses manageable configured over-limit history and matches complete array HTTP and response bytes', async () => {
    const array = await ladderAttempt(root(), false, false);
    const source = await ladderAttempt(root(), true, false);
    receipt('ladder-parity-false', { array, source });
    expect(array.error).toBeUndefined();
    expect(array.bodies).toHaveLength(1);
    expect(array.estimate?.estimatedPromptTokens).toBeLessThanOrEqual(
      3015 - 128,
    );
    assertSourceSuccess(source);
    expect(source.bodies).toStrictEqual(array.bodies);
    expect(source.output).toStrictEqual(array.output);
    expect(source.estimate).toStrictEqual(array.estimate);
  }, 600000);

  it('compresses a valid individual row above 10MiB without a universal cap or preflight HTTP send', async () => {
    const source = await ladderAttempt(root(), true, true);
    receipt('ladder-parity-true', { source });
    assertSourceSuccess(source);
    expect(source.estimate).not.toBeNull();
  }, 600000);
});
