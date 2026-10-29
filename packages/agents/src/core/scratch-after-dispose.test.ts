/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { ladderAttempt } from './__tests__/support/source-compression-ladder-fixture.js';

const root = sourceRootSetup();

describe('default send with compression, after dispose', () => {
  it('leaves no scratch entries in the process-owned scratch root', async () => {
    const before = readdirSync(getScratchRoot());

    const attempt = await ladderAttempt(root(), true, false);

    expect(attempt.error).toBeUndefined();
    expect(attempt.stages).toContain('compress');
    const leaked = () =>
      readdirSync(getScratchRoot()).filter((name) => !before.includes(name));
    // HistoryJournalStore.dispose() is synchronous and removes its recorder
    // scratch once the recorder's async disposal settles.
    for (let i = 0; i < 100 && leaked().length > 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(leaked()).toStrictEqual([]);
  });
});
