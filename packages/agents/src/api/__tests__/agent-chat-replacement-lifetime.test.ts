import { capturedAgentClient } from './helpers/agent-client-observation.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as journalOpen from '@vybestack/llxprt-code-core/journal/journalWriterOpen.js';
import type { JournalFileHandle } from '@vybestack/llxprt-code-core/journal/positionalFile.js';
import { buildAgent, type Agent } from './helpers/agentHarness.js';

async function replaceChat(agent: Agent, operation: string): Promise<void> {
  if (operation === 'start') {
    await capturedAgentClient(agent).startChat();
    return;
  }
  const config = capturedAgentClient(agent).getContentGeneratorConfig();
  if (config === undefined) throw new Error('Missing generator config');
  await capturedAgentClient(agent).initialize(config);
}

describe('Agent client chat replacement lifetime', () => {
  it.each(['start', 'initialize'])(
    'closes every replaced chat journal after %s before agent disposal completes',
    async (operation) => {
      const handles: JournalFileHandle[] = [];
      const create = journalOpen.createSynchronousJournal;
      const opener = spyOn(
        journalOpen,
        'createSynchronousJournal',
      ).mockImplementation((handle, dependencies) => {
        handles.push(handle);
        return create(handle, dependencies);
      });
      try {
        const { agent, cleanup } = await buildAgent('plain-text.jsonl');
        try {
          await capturedAgentClient(agent).startChat();
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
        await Promise.allSettled(handles.map((handle) => handle.close()));
      }
    },
  );
});
