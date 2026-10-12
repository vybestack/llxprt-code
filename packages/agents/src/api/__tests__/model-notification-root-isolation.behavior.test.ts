/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  FakeProvider,
  type GenerateChatOptions,
} from '@vybestack/llxprt-code-providers';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { fileURLToPath } from 'node:url';
import { fromConfig } from '../fromConfig.js';
import { useProfileOwner } from './helpers/profile-owner-fixture.js';

function gate(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    throw new Error('Gate was not initialized');
  };
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('session-owned model notifications', () => {
  const first = useProfileOwner();
  const second = useProfileOwner();

  it('changes A without invalidating B chat, history or admitted model selection', async () => {
    const a = first();
    const b = second();
    await a.agentClient.startChat();
    await b.agentClient.startChat();
    const bClient = b.agentClient;
    const bChat = bClient.getChat();
    const bHistory = bClient.getHistory();
    const bModel = b.settingsOwner.readSelectedModel();
    const bSequence = bClient.getCurrentSequenceModel();

    await a.switchProvider('anthropic');

    expect(bClient.hasChatInitialized()).toBe(true);
    expect(bClient.getChat()).toBe(bChat);
    expect(bClient.getHistory()).toStrictEqual(bHistory);
    expect(bClient.getCurrentSequenceModel()).toBe(bSequence);
    expect(b.settingsOwner.readSelectedModel()).toBe(bModel);
    expect(a.settingsOwner.readSelectedProvider()).toBe('anthropic');

    const publication = a.settingsOwner.beginModelPublication();
    a.settingsOwner.chooseModel('changed-in-a');
    publication.commit();
    expect(bClient.getChat()).toBe(bChat);
    expect(b.settingsOwner.readSelectedModel()).toBe(bModel);

    const notices: unknown[] = [];
    const release = a.settingsOwner.subscribeModelChanges((profile) => {
      notices.push(profile);
    });
    await expect(a.switchProvider('missing-provider')).rejects.toThrow(
      "Provider 'missing-provider' not found",
    );
    expect(notices).toStrictEqual([]);
    release();
    expect(bClient.getChat()).toBe(bChat);
    await a.cleanup();
    expect(bClient.getChat()).toBe(bChat);
    await bClient.startChat();
    expect(bClient.hasChatInitialized()).toBe(true);
  });

  it('keeps B admitted request and chat usable while its provider response is held during A switch', async () => {
    const a = first();
    const b = second();
    const entered = gate();
    const releaseResponse = gate();
    const admittedModels: unknown[] = [];
    class HeldProvider extends FakeProvider {
      override async *generateChatCompletion(
        options: GenerateChatOptions | IContent[],
      ): AsyncIterableIterator<IContent> {
        if (Array.isArray(options))
          throw new Error('Expected admitted provider request');
        admittedModels.push(options.invocation?.getEphemeral('model'));
        entered.resolve();
        await releaseResponse.promise;
        yield* super.generateChatCompletion(options);
      }
    }
    b.manager.registerProvider(
      new HeldProvider(
        fileURLToPath(new URL('./fixtures/plain-text.jsonl', import.meta.url)),
        b.directory,
      ),
    );
    const agentB = await fromConfig({
      config: b.config,
      settingsOwner: b.settingsOwner,
      settingsService: b.settings,
      providerManager: b.manager,
      oauthManager: b.oauth,
      mcpRuntime: b.mcpRuntime,
      messageBus: b.messageBus,
    });
    await agentB.agentClient.startChat();
    const chat = agentB.agentClient.getChat();
    const model = b.settingsOwner.readSelectedModel();
    const completion = (async () => {
      const events = [];
      for await (const event of agentB.stream('Keep this request bound to B', {
        mcpDiscovery: 'skip',
      }))
        events.push(event);
      return events;
    })();
    try {
      await entered.promise;
      await a.switchProvider('anthropic');
      expect(agentB.agentClient.getChat()).toBe(chat);
      releaseResponse.resolve();
      const events = await completion;
      expect(events.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
      expect(events.some((event) => event.type === 'done')).toBe(true);
      expect(admittedModels).toStrictEqual([model]);
      expect(agentB.agentClient.hasChatInitialized()).toBe(true);
      expect(agentB.agentClient.getChat()).toBe(chat);
      expect(
        (await agentB.getHistory()).some(
          (message) => message.speaker === 'human',
        ),
      ).toBe(true);
    } finally {
      releaseResponse.resolve();
      await completion;
      await agentB.dispose();
    }
  }, 30000);
});
