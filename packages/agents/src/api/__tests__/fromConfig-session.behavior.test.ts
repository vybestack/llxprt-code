/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  activateAdoptedSession,
  initializeAdoptedClient,
} from '../fromConfig-session.js';
import type { ProviderActivationIntent } from '../config-types.js';
import { createSessionClientEngineFixture } from './helpers/session-client-engine-fixture.js';

describe('adopted session explicit collaborators', () => {
  it('retains the supplied client and factories while selecting the activation model', async () => {
    const fixture = await createSessionClientEngineFixture();
    const { handle, config, mcp, media, owner } = fixture;
    const activation: ProviderActivationIntent = {
      provider: 'fake',
      model: 'adopted-model',
      authMode: 'none',
    };
    const client = await initializeAdoptedClient(
      config,
      fixture.settingsService,
      handle.settingsOwner,
      handle.providerManager,
      handle.oauthManager,
      handle.contentGeneratorFactory,
      handle.tokenizerFactory,
      handle.providerFileLifecycle,
      media,
      mcp.readInstructions,
      mcp.workspacePaths,
      activation,
      undefined,
      undefined,
      owner.getAgentClient(),
      fixture.messageBus,
      undefined,
    );
    try {
      expect(client.getAgentClient()).toBe(owner.getAgentClient());
      expect(client.tokenizerFactory).toBe(handle.tokenizerFactory);
      expect(client.contentGeneratorFactory).toBe(
        handle.contentGeneratorFactory,
      );
      await activateAdoptedSession(
        config,
        fixture.settingsService,
        handle.settingsOwner,
        handle.providerManager,
        handle.oauthManager,
        () => handle.readRuntimeKind(),
        client,
        activation,
        undefined,
      );
      expect(handle.settingsOwner.readSelectedModel()).toBe(activation.model);
      expect(handle.providerManager.getActiveProviderName()).toBe('fake');
      expect(client.getAgentClient().isInitialized()).toBe(true);
    } finally {
      await client.dispose();
      await fixture.cleanup();
    }
  });
});
