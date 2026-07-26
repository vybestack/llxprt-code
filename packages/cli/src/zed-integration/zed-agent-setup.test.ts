/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { enableZedSessionRecording } from './zed-agent-setup.js';

describe('enableZedSessionRecording', () => {
  it('does not let a failing notification callback replace a recording failure', async () => {
    const recordingError = new Error('recording unavailable');
    const onFailure = vi.fn(() => {
      throw new Error('notification failed');
    });
    const agent = {
      session: {
        setRecording: vi.fn(async () => {
          throw recordingError;
        }),
      },
    } as unknown as Agent;

    await expect(
      enableZedSessionRecording(agent, onFailure),
    ).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledWith(recordingError);
  });
});
