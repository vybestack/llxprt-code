/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as journalOpen from '@vybestack/llxprt-code-core/journal/journalWriterOpen.js';
import type { JournalFileHandle } from '@vybestack/llxprt-code-core/journal/positionalFile.js';
import { buildAgent } from './helpers/agentHarness.js';

describe('Agent client chat replacement lifetime', () => {
  it('closes every replaced chat journal before agent disposal completes', async () => {
    const handles: JournalFileHandle[] = [];
    const resolve = journalOpen.resolveJournalDependencies;
    const opener = spyOn(
      journalOpen,
      'resolveJournalDependencies',
    ).mockImplementation(async (overrides) => {
      const dependencies = await resolve(overrides);
      return {
        ...dependencies,
        open: async (path, flags) => {
          const handle = await dependencies.open(path, flags);
          handles.push(handle);
          return handle;
        },
      };
    });
    try {
      const { agent, cleanup } = await buildAgent('plain-text.jsonl');
      try {
        await agent.agentClient.startChat();
        await agent.agentClient.startChat();
      } finally {
        await cleanup();
      }
      expect(handles.length).toBeGreaterThan(0);
      for (const handle of handles) {
        await expect(handle.stat()).rejects.toThrow();
      }
    } finally {
      opener.mockRestore();
      for (const handle of handles) await handle.close();
    }
  });
});
