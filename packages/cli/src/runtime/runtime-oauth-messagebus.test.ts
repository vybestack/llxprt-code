/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageBus } from '@vybestack/llxprt-code-core';
import { OAuthManager } from '../auth/oauth-manager.js';
import {
  createIsolatedRuntimeContext,
  activateIsolatedRuntimeContext,
  registerCliProviderInfrastructure,
  resetCliProviderInfrastructure,
} from './runtimeSettings.js';

describe('runtime/provider OAuth MessageBus seam integration', () => {
  beforeEach(() => {
    resetCliProviderInfrastructure();
  });

  afterEach(async () => {
    resetCliProviderInfrastructure();
    vi.restoreAllMocks();
  });

  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P07
   * @requirement REQ-D01-003.3
   * @requirement REQ-D01-004.3
   * @pseudocode lines 83-91
   */
  it('propagates the session MessageBus when runtime registration passes the explicit MessageBus dependency', async () => {
    const runtimeHandle = createIsolatedRuntimeContext({
      runtimeId: 'runtime-auth-messagebus',
      workspaceDir: process.cwd(),
      model: 'runtime-auth-model',
      metadata: { source: 'phase-07-runtime-test' },
      prepare: async () => {},
    });

    await activateIsolatedRuntimeContext(runtimeHandle, {
      runtimeId: runtimeHandle.runtimeId,
      metadata: { source: 'phase-07-runtime-test' },
    });

    const providerManager = {
      setConfig: vi.fn(),
    };
    const sessionMessageBus = new MessageBus(
      runtimeHandle.config.getPolicyEngine(),
      runtimeHandle.config.getDebugMode(),
    );

    const oauthManager = new OAuthManager(
      {
        getToken: vi.fn().mockResolvedValue(null),
        saveToken: vi.fn(),
        removeToken: vi.fn(),
        listProviders: vi.fn(),
        listBuckets: vi.fn(),
        acquireRefreshLock: vi.fn(),
        releaseRefreshLock: vi.fn(),
      } as never,
      undefined,
      { messageBus: sessionMessageBus },
    );

    registerCliProviderInfrastructure(providerManager as never, oauthManager, {
      messageBus: sessionMessageBus,
    });

    expect(
      (oauthManager as unknown as { runtimeMessageBus?: MessageBus })
        .runtimeMessageBus,
    ).toBe(sessionMessageBus);

    await runtimeHandle.cleanup();
  });
});
