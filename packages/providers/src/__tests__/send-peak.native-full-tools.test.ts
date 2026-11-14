/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { runNativeSendPeak } from './support/native-send-peak-runner.js';
import { assertNativeFullProtocol } from './support/native-full-protocol-assertions.js';

describe('native plain Chat original three-pair tool-heavy protocol', () => {
  it('measures cold large fill, three pairs and six retained sends', async () => {
    const run = await runNativeSendPeak('tool-heavy', 'original-three-pair');
    expect(run.series.accumulation).toHaveLength(6);
    assertNativeFullProtocol(run, [
      '9d8062463836acf4bbce98a47e5513eedf4f178928efaa0f652a0124ba0f93b5',
      '7a7dc35d672c2f03c11a7ba6fdaf41f1f0189d5fa4993278126cae948a6591fd',
    ]);
  }, 170000);
});
