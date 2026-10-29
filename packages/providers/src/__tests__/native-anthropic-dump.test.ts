/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { nativeDumpBehavior } from './support/native-dump-fixture.js';

describe('native Anthropic request dumps', () => {
  for (const mode of ['on', 'error']) {
    for (const fail of [false, true]) {
      it(`preserves sent and dumped bytes without scratch files: ${mode}, failure=${fail}`, async () => {
        expect.hasAssertions();
        await nativeDumpBehavior('anthropic-cache-off', mode, fail);
      });
    }
  }
});
