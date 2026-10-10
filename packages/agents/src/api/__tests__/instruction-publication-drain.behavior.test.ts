/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromConfig } from '../fromConfig.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

function gate(): { readonly promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('admitted instruction publication disposal', () => {
  it.each([false, true])(
    'joins asynchronous assembly and retains the borrowed caller reader (peer closes first: %s)',
    async (peerFirst) => {
      const directory = await mkdtemp(join(tmpdir(), 'instruction-drain-'));
      await writeFile(
        join(directory, 'LLXPRT.md'),
        'Physical admitted instructions.',
      );
      const caller = await buildCliStyleConfig('multi-turn-text.jsonl', {
        workingDir: directory,
      });
      const agent = await fromConfig({
        config: caller.config,
        settingsOwner: caller.settingsOwner,
        settingsService: caller.settingsService,
        agentClient: caller.agentClient,
        providerManager: caller.providerManager,
        mcpRuntime: caller.mcpRuntime,
        messageBus: caller.messageBus,
      });
      const peer = await fromConfig({
        config: caller.config,
        settingsOwner: caller.settingsOwner,
        settingsService: caller.settingsService,
        providerManager: caller.providerManager,
        mcpRuntime: caller.mcpRuntime,
        messageBus: caller.messageBus,
      });
      const entered = gate();
      const release = gate();
      const client = caller.agentClient;
      const assemble = client.updateSystemInstruction.bind(client);
      let publishedCharacters = 0;
      const observer = vi
        .spyOn(client, 'updateSystemInstruction')
        .mockImplementation(
          async (
            instructions = caller.sessionClient.instructionReads,
          ): Promise<void> => {
            entered.release();
            await release.promise;
            await assemble(instructions);
            publishedCharacters = instructions.snapshot().memoryContent.length;
          },
        );
      let closed = false;
      let publication: Promise<unknown> | undefined;
      let closing: Promise<void> | undefined;
      try {
        agent.memory.setMemory('Admitted facade instructions.');
        publication = caller.mcpRuntime.refreshContext();
        await entered.promise;
        if (peerFirst) await peer.dispose();
        closing = agent.dispose().then(() => {
          closed = true;
        });
        await Promise.resolve();
        expect(closed).toBe(false);
        release.release();
        await publication;
        await closing;
        expect(publishedCharacters).toBeGreaterThan(0);
        caller.settingsOwner.writeUserParameter('maxOutputTokens', 79);
        expect(caller.settingsService.get('maxOutputTokens')).toBe(79);
        await client.updateSystemInstruction();
        expect(client.isInitialized()).toBe(true);
        const result = peerFirst
          ? undefined
          : await peer.chat('peer after admitted disposal');
        expect(result?.error).toBeUndefined();
      } finally {
        release.release();
        await Promise.allSettled([publication, closing]);
        observer.mockRestore();
        await agent.dispose();
        await peer.dispose();
        await caller.cleanup();
        await rm(directory, { recursive: true, force: true });
      }
    },
    30000,
  );
});
