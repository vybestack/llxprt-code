/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentClientContract } from '@vybestack/llxprt-code-core';

/**
 * Minimal source contract for creating a detached auto-prompt client. In
 * practice the source is always a {@link Config} instance, but this interface
 * keeps the dependency narrow so the auto-prompt generator does not need the
 * full Config type.
 */
export interface DetachedAutoPromptClientSource {
  createDetachedAgentClient?(runtimeId?: string): AgentClientContract;
}

/**
 * Creates a detached agent client for subagent auto-prompt generation. The
 * client has a fresh runtime state (isolated from the session's primary
 * client) and its tool set cleared. Runtime assembly is handled inside
 * {@link Config.createDetachedAgentClient} (core), not in CLI code (#2378).
 */
export function createDetachedAutoPromptClient(
  source: DetachedAutoPromptClientSource,
): AgentClientContract {
  if (typeof source.createDetachedAgentClient !== 'function') {
    throw new Error(
      'createDetachedAgentClient is not available on this runtime source.',
    );
  }
  return source.createDetachedAgentClient();
}
