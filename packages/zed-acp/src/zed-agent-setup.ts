/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';

export async function enableZedSessionRecording(
  enableRecording: () => ReturnType<Agent['session']['setRecording']>,
  onFailure: (error: unknown) => void,
): Promise<void> {
  try {
    await enableRecording();
  } catch (error) {
    try {
      onFailure(error);
    } catch {
      // Recording remains best-effort even when failure notification fails.
    }
  }
}

export async function buildZedSession<T>(
  retireAgent: Agent['dispose'],
  build: () => T | Promise<T>,
  onDisposeFailure: (error: unknown) => void,
): Promise<T> {
  try {
    return await build();
  } catch (error) {
    try {
      await retireAgent();
    } catch (disposeError) {
      try {
        onDisposeFailure(disposeError);
      } catch {
        // Preserve the original session build failure.
      }
    }
    throw error;
  }
}
