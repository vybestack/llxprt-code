/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RecordingIntegration,
  SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import { renderHook } from '../../../../__tests__/render.js';
import { useRecordingInfrastructure } from './useRecordingInfrastructure.js';

describe('interactive recording resources', () => {
  it('does not expose raw swap resources for an Agent-owned mount', () => {
    const { result, unmount } = renderHook(() =>
      useRecordingInfrastructure(undefined, undefined, undefined, 'agent'),
    );
    expect(result.current.recordingSwapCallbacks).toBeUndefined();
    expect(result.current.recordingIntegrationRef).toBeUndefined();
    unmount();
  });

  it('preserves raw swap identity and updates the current recording on resume', async () => {
    const options = {
      projectHash: 'raw-hook-test',
      chatsDir: join(tmpdir(), 'llxprt-recording-cli-react-resources'),
      workspaceDirs: [],
      provider: 'fake',
      model: 'fake-model',
    };
    const first = new SessionRecordingService({
      ...options,
      sessionId: 'raw-first',
    });
    const second = new SessionRecordingService({
      ...options,
      sessionId: 'raw-second',
    });
    const firstIntegration = new RecordingIntegration(first);
    const secondIntegration = new RecordingIntegration(second);
    const { result, rerender, unmount } = renderHook(() =>
      useRecordingInfrastructure(first, firstIntegration),
    );
    try {
      const callbacks = result.current.recordingSwapCallbacks;
      expect(callbacks?.getCurrentRecording()).toBe(first);
      expect(result.current.recordingIntegrationRef?.current).toBe(
        firstIntegration,
      );
      rerender();
      callbacks?.setRecording(second, secondIntegration, null, {
        sessionId: 'raw-second',
        projectHash: options.projectHash,
        provider: options.provider,
        model: options.model,
        workspaceDirs: [],
        startTime: new Date().toISOString(),
      });
      expect(result.current.recordingSwapCallbacks?.getCurrentRecording()).toBe(
        second,
      );
      expect(callbacks?.getCurrentIntegration()).toBe(secondIntegration);
      expect(result.current.recordingIntegrationRef?.current).toBe(
        secondIntegration,
      );
    } finally {
      unmount();
      await firstIntegration.dispose();
      await secondIntegration.dispose();
      await first.dispose();
      await second.dispose();
    }
  });
});
