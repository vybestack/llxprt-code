/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';

export async function enableZedSessionRecording(
  agent: Agent,
  onFailure: (error: unknown) => void,
): Promise<void> {
  try {
    await agent.session.setRecording({ enabled: true });
  } catch (error) {
    onFailure(error);
  }
}

export async function buildZedSession<T>(
  agent: Agent,
  build: () => T | Promise<T>,
  onDisposeFailure: (error: unknown) => void,
): Promise<T> {
  try {
    return await build();
  } catch (error) {
    try {
      await agent.dispose();
    } catch (disposeError) {
      onDisposeFailure(disposeError);
    }
    throw error;
  }
}
