/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { nativeDumpBehavior } from './support/native-dump-fixture.js';

describe('native Responses request dumps', () => {
  for (const route of ['openai-responses', 'openai-responses-via-openai']) {
    for (const mode of ['on', 'error']) {
      for (const fail of [false, true]) {
        it(`preserves sent and dumped bytes without a second history walk: ${route}/${mode}, failure=${fail}`, async () => {
          expect.hasAssertions();
          await nativeDumpBehavior(route, mode, fail);
        });
      }
    }
  }
});
