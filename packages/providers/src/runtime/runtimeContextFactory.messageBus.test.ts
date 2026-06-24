/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P12
 * @requirement:REQ-001
 *
 * RED contract for the cross-package `messageBus?: MessageBus` seam that P15
 * will add to IsolatedRuntimeContextOptions. This is a PROVIDERS-local test
 * (NOT under agents api/__tests__, so NOT subject to the T17 boundary scan)
 * and mirrors the conventions of runtime-oauth-messagebus.test.ts.
 *
 * It asserts:
 * (1) DEFAULT behavior — with NO messageBus option, the runtime still builds a
 *     private bus and activates (matching runtimeId/config/settings/providerManager
 *     on the handle).
 * (2) WHEN a caller-provided MessageBus is passed in options, the runtime uses
 *     THAT exact bus (identity) rather than a private one — observable through
 *     the OAuthManager's runtimeMessageBus (the same projection the neighbor
 *     runtime-oauth-messagebus.test.ts asserts).
 *
 * At RED the factory IGNORES the unknown messageBus field and builds its own
 * bus, so the provided-bus identity assertion FAILS NATURALLY. At GREEN (P15)
 * the field is honored and the test passes with no rewrite.
 *
 * ⚠ Trap A: options is built as a VARIABLE typed with an intersection
 * (`IsolatedRuntimeContextOptions & { messageBus?: MessageBus }`) so
 * TypeScript's excess-property check does not reject the fresh object literal —
 * this keeps `npm run typecheck` GREEN for providers while still failing at
 * runtime.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MessageBus } from '@vybestack/llxprt-code-core';
import type {
  IsolatedRuntimeContextHandle,
  IsolatedRuntimeContextOptions,
} from './runtimeSettings.js';
import {
  createIsolatedRuntimeContext,
  activateIsolatedRuntimeContext,
  registerCliProviderInfrastructure,
  resetCliProviderInfrastructure,
} from './runtimeSettings.js';

/**
 * Intersection type that adds the not-yet-existing `messageBus?` field to the
 * options. Building `opts` as a VARIABLE of this type dodges TS excess-property
 * checking (Trap A) while remaining structurally assignable to the real
 * IsolatedRuntimeContextOptions (the extra field is ignored at runtime until
 * P15 honors it).
 */
type OptionsWithBus = IsolatedRuntimeContextOptions & {
  messageBus?: MessageBus;
};

describe('runtime context messageBus seam (P12 RED) @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-001', () => {
  beforeEach(() => {
    resetCliProviderInfrastructure();
  });

  afterEach(async () => {
    resetCliProviderInfrastructure();
  });

  it('DEFAULT — with no messageBus option the runtime builds a private bus and activates; handle matches runtimeId/config/settings/providerManager @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-001', async () => {
    const handle: IsolatedRuntimeContextHandle = createIsolatedRuntimeContext({
      runtimeId: 'p12-mb-default',
      workspaceDir: process.cwd(),
      model: 'p12-default-model',
      metadata: { source: 'p12-messageBus-default' },
      prepare: async () => {},
    });

    try {
      await activateIsolatedRuntimeContext(handle, {
        runtimeId: handle.runtimeId,
        metadata: { source: 'p12-messageBus-default' },
      });

      // the handle carries the real resolved services (default behavior)
      expect(handle.runtimeId).toBe('p12-mb-default');
      expect(handle.config).toBeDefined();
      expect(handle.settingsService).toBeDefined();
      expect(handle.providerManager).toBeDefined();
      expect(handle.oauthManager).toBeDefined();

      // the providerManager is linked to the config (activation succeeded)
      handle.providerManager.setConfig(handle.config);
      const providers = handle.providerManager.listProviders();
      expect(Array.isArray(providers)).toBe(true);
    } finally {
      await handle.cleanup();
    }
  });

  it('PROVIDED BUS — when a caller-provided MessageBus is passed, the runtime uses THAT exact bus (identity) @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-001', async () => {
    const providedBus = new MessageBus(undefined, false);

    // Build options as a VARIABLE of the intersection type so the extra
    // messageBus field does not trip TS excess-property checking (Trap A).
    const opts: OptionsWithBus = {
      runtimeId: 'p12-mb-provided',
      workspaceDir: process.cwd(),
      model: 'p12-provided-model',
      metadata: { source: 'p12-messageBus-provided' },
      prepare: async () => {},
      messageBus: providedBus,
    };

    const handle: IsolatedRuntimeContextHandle =
      createIsolatedRuntimeContext(opts);

    try {
      await activateIsolatedRuntimeContext(handle, {
        runtimeId: handle.runtimeId,
        metadata: { source: 'p12-messageBus-provided' },
      });

      // Register infrastructure with the provided bus (mirrors the neighbor
      // runtime-oauth-messagebus.test.ts registration pattern). When P15 honors
      // options.messageBus, the runtime's internal sessionMessageBus IS the
      // provided bus, so the OAuthManager's runtimeMessageBus === providedBus.
      registerCliProviderInfrastructure(
        handle.providerManager,
        handle.oauthManager,
        { messageBus: providedBus },
      );

      // Observe which bus the OAuthManager wired as its runtime bus — the same
      // projection the neighbor runtime-oauth-messagebus.test.ts asserts.
      const runtimeBus = (
        handle.oauthManager as unknown as {
          runtimeMessageBus?: MessageBus;
        }
      ).runtimeMessageBus;

      // IDENTITY assertion: the OAuthManager's runtime bus IS the provided bus.
      // At RED the factory built its OWN private bus (options.messageBus was
      // ignored), so runtimeBus !== providedBus and this FAILS NATURALLY.
      // At GREEN (P15) the field is honored and runtimeBus === providedBus.
      expect(runtimeBus).toBe(providedBus);
    } finally {
      await handle.cleanup();
    }
  });
});
