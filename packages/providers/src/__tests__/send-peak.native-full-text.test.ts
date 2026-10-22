/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { runNativeSendPeak } from './support/native-send-peak-runner.js';
import { assertNativeFullProtocol } from './support/native-full-protocol-assertions.js';

describe('native plain Chat original three-pair text protocol', () => {
  it('measures cold large fill, three pairs and six retained sends', async () => {
    const run = await runNativeSendPeak('text-only', 'original-three-pair');
    expect(run.series.accumulation).toHaveLength(6);
    assertNativeFullProtocol(run, [
      '3da50735dd9871e72f2a1a02ee960c00ea2cbc36c0a91d8889a40220f7759de2',
      '7f4fd024a6b943136ab12a1323f40be8bdddf9fe8a2b3ce8c359d5b2efca268e',
    ]);
  }, 170000);
});
