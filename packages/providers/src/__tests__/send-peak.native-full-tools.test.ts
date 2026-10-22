/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { runNativeSendPeak } from './support/native-send-peak-runner.js';
import { assertNativeFullProtocol } from './support/native-full-protocol-assertions.js';

describe('native plain Chat original three-pair tool-heavy protocol', () => {
  it('measures cold large fill, three pairs and six retained sends', async () => {
    const run = await runNativeSendPeak('tool-heavy', 'original-three-pair');
    expect(run.series.accumulation).toHaveLength(6);
    assertNativeFullProtocol(run, [
      'a31fc26d960da4e93be21a938a47a53fb1bfbaa3791cca5ce4e4e2d7f813f906',
      'fd7489eb6e0dfc6c4012b03fe0d43ab83afd86a658427ec3b33776b29b7bf836',
    ]);
  }, 170000);
});
