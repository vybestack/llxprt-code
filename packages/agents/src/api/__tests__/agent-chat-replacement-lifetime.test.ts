/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as journalOpen from '@vybestack/llxprt-code-core/journal/journalWriterOpen.js';
import type { JournalFileHandle } from '@vybestack/llxprt-code-core/journal/positionalFile.js';
import { buildAgent, type Agent } from './helpers/agentHarness.js';

async function replaceChat(agent: Agent, operation: string): Promise<void> {
  if (operation === 'start') {
    await agent.agentClient.startChat();
    return;
  }
  const config = agent.agentClient.getContentGeneratorConfig();
  if (config === undefined) throw new Error('Missing generator config');
  await agent.agentClient.initialize(config);
}

describe('Agent client chat replacement lifetime', () => {
  it.each(['start', 'initialize'])(
    'closes every replaced chat journal after %s before agent disposal completes',
    async (operation) => {
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
          await replaceChat(agent, operation);
        } finally {
          await cleanup();
        }
        expect(handles.length).toBeGreaterThan(0);
        for (const handle of handles) {
          await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
        }
      } finally {
        opener.mockRestore();
        for (const handle of handles) await handle.close();
      }
    },
  );
});
