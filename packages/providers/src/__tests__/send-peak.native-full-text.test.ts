/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { runNativeSendPeak } from './support/native-send-peak-runner.js';
import { assertNativeFullProtocol } from './support/native-full-protocol-assertions.js';

describe('native plain Chat original three-pair text protocol', () => {
  it('measures cold large fill, three pairs and six retained sends', async () => {
    const run = await runNativeSendPeak('text-only', 'original-three-pair');
    expect(run.series.accumulation).toHaveLength(6);
    assertNativeFullProtocol(run, [
      'fd1da2829bf565ba22514d4285ab453c288b96c592bd3d68f007b800c210c4ee',
      '4d698ae799b5f64601724064d43a0f2ab4da8757130b13731ffce3eb15f5b948',
    ]);
  }, 170000);
});
