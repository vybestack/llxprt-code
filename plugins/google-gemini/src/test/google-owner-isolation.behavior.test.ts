/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  useProfileOwner,
  standardProfile,
} from '../../../../packages/providers/src/runtime/__tests__/profile-workflow-owner-fixture.js';
import { GeminiProvider } from '../gemini/GeminiProvider.js';
import type { GeminiApiClientOptions } from '../gemini/geminiWireTypes.js';
import { createProviderCallOptions } from './testSupport.js';

describe('Google authentication owner isolation', () => {
  const rootA = useProfileOwner();
  const rootB = useProfileOwner();

  it('keeps interleaved Google profiles and client configuration local to two live roots', async () => {
    const environment = { ...process.env };
    const clients: GeminiApiClientOptions[] = [];
    const makeProvider = (): GeminiProvider =>
      new GeminiProvider(undefined, undefined, undefined, async (options) => {
        clients.push(options);
        return {
          models: {
            generateContent: async () => ({
              candidates: [
                {
                  content: { role: 'model', parts: [{ text: 'reply' }] },
                  finishReason: 'STOP',
                },
              ],
            }),
            generateContentStream: async () => {
              throw new Error('Unexpected streaming request');
            },
          },
        };
      });
    const a = makeProvider();
    const b = makeProvider();
    a.setRuntimeSettingsService(rootA().settings);
    b.setRuntimeSettingsService(rootB().settings);
    const apply = async (
      root: ReturnType<typeof rootA>,
      project: string,
      location: string,
    ): Promise<void> => {
      await root.application.applySnapshot(
        standardProfile({
          GOOGLE_CLOUD_PROJECT: project,
          GOOGLE_CLOUD_LOCATION: location,
          streaming: 'disabled',
        }),
      );
    };
    const send = async (
      provider: GeminiProvider,
      root: ReturnType<typeof rootA>,
      authToken = '',
    ): Promise<void> => {
      const options = createProviderCallOptions({
        providerName: 'gemini',
        settings: root.settings,
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
        ],
        resolved: { model: 'gemini-2.5-flash', authToken },
        systemInstruction: 'system',
      });
      for await (const chunk of provider.generateChatCompletion(options))
        expect(chunk.speaker).toBe('ai');
    };
    await apply(rootA(), 'project-a', 'us-central1');
    await apply(rootB(), 'project-b', 'europe-west4');
    await send(a, rootA());
    await send(b, rootB());
    await apply(rootA(), 'project-a-next', 'asia-east1');
    await send(b, rootB());
    await send(a, rootA());
    expect(
      clients.map(({ project, location, vertexai }) => ({
        project,
        location,
        vertexai,
      })),
    ).toStrictEqual([
      { project: 'project-a', location: 'us-central1', vertexai: true },
      { project: 'project-b', location: 'europe-west4', vertexai: true },
      { project: 'project-b', location: 'europe-west4', vertexai: true },
      { project: 'project-a-next', location: 'asia-east1', vertexai: true },
    ]);
    rootA().manager.dispose();
    await rootA().settingsOwner.dispose();
    await rootA().config.dispose();
    await send(b, rootB());
    expect(clients[clients.length - 1]?.project).toBe('project-b');
    await rootB().application.applySnapshot(
      standardProfile({
        GOOGLE_CLOUD_PROJECT: 'project-b',
        GOOGLE_CLOUD_LOCATION: 'europe-west4',
        GOOGLE_GENAI_USE_VERTEXAI: false,
        streaming: 'disabled',
      }),
    );
    await send(b, rootB(), 'explicit-api-key');
    expect(clients[clients.length - 1]?.vertexai).toBe(false);
    expect(clients[clients.length - 1]?.project).toBeUndefined();
    expect(clients[clients.length - 1]?.location).toBeUndefined();

    expect(
      Object.fromEntries(
        Object.entries(process.env).filter(([, value]) => value !== undefined),
      ),
    ).toStrictEqual(
      Object.fromEntries(
        Object.entries(environment).filter(([, value]) => value !== undefined),
      ),
    );
  });
});
