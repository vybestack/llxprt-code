/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the AgentClientSource bridge in cliUiRuntime.ts
 * (#2378 review remediation — Finding 4).
 *
 * Verifies that buildAgentClientSource correctly bridges the detached-client
 * factory from the bare source to the AgentClientSource capability, ensuring
 * that createDetachedAutoPromptClient can delegate through the UI runtime
 * boundary to the underlying Config.createDetachedAgentClient.
 */

import { describe, expect, it } from 'vitest';
import type { AgentClientContract } from '@vybestack/llxprt-code-core';
import {
  buildSlashCommandRuntime,
  type UiRuntimeBareSource,
} from './cliUiRuntime.js';

/**
 * Minimal source for the detached-client bridge behavior.
 *
 * `buildUiRuntimeFromSource` wraps EVERY source method in a lazy arrow
 * delegate that is only invoked when the corresponding runtime method is
 * called. These tests only build the runtime and read its
 * `createDetachedAgentClient` bridge, so the arrow-wrapped delegates are never
 * invoked and do not need real implementations. The ONLY fields read eagerly
 * at build time are the two VALUE fields `storage` and
 * `extensionEnablementManager`, so those are the only members this fake must
 * supply (beyond the agent-client members under test). The full ~130-method
 * Config surface would be structural theater here, so it is intentionally
 * omitted and the object is narrowed through the documented test-double idiom
 * (`as unknown as UiRuntimeBareSource`).
 */
function makeBareSource(
  overrides: {
    createDetachedAgentClient?: (runtimeId?: string) => AgentClientContract;
  } = {},
): UiRuntimeBareSource {
  return {
    getAgentClient: () => ({ id: 'primary' }) as unknown as AgentClientContract,
    getAgentClientFactory: () => undefined,
    ...(overrides.createDetachedAgentClient
      ? { createDetachedAgentClient: overrides.createDetachedAgentClient }
      : {}),
    // The two fields read eagerly by buildUiRuntimeFromSource.
    storage: { getGlobalConfigDir: () => '' } as never,
    extensionEnablementManager: undefined,
  } as unknown as UiRuntimeBareSource;
}

describe('AgentClientSource detached-client bridge (buildSlashCommandRuntime)', () => {
  it('bridges createDetachedAgentClient to the flattened runtime when present on the source', () => {
    const expectedClient = { id: 'detached' } as unknown as AgentClientContract;
    const source = makeBareSource({
      createDetachedAgentClient: () => expectedClient,
    });

    const runtime = buildSlashCommandRuntime(source);

    expect(typeof runtime.createDetachedAgentClient).toBe('function');
    const result = runtime.createDetachedAgentClient!();
    expect(result).toBe(expectedClient);
  });

  it('omits createDetachedAgentClient from the flattened runtime when absent on the source', () => {
    const source = makeBareSource();

    const runtime = buildSlashCommandRuntime(source);

    expect(runtime.createDetachedAgentClient).toBeUndefined();
  });
});
