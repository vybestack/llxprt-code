/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '../../test-utils/render.js';
import type {
  Config,
  CodeAssistServer,
  LoadCodeAssistResponse,
} from '@vybestack/llxprt-code-core';
import { UserTierId } from '@vybestack/llxprt-code-core';
import { usePrivacySettings } from './usePrivacySettings.js';

describe('usePrivacySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw error when content generator is not a CodeAssistServer', async () => {
    // Mock config to return undefined content generator
    const testConfig = {
      getGeminiClient: vi.fn().mockReturnValue({
        getContentGenerator: vi.fn().mockReturnValue(undefined),
      }),
    } as unknown as Config;

    const { result } = renderHook(() => usePrivacySettings(testConfig));

    await waitFor(() => {
      expect(result.current.privacyState.isLoading).toBe(false);
    });

    expect(result.current.privacyState.error).toBe('Oauth not being used');
  });

  it('should handle paid tier users correctly', async () => {
    // Mock paid tier response
    const mockCodeAssistServer = {
      projectId: 'test-project-id',
      loadCodeAssist: vi.fn().mockResolvedValue({
        currentTier: { id: UserTierId.STANDARD },
      } as LoadCodeAssistResponse),
    } as unknown as CodeAssistServer;

    const testConfig = {
      getGeminiClient: vi.fn().mockReturnValue({
        getContentGenerator: vi.fn().mockReturnValue(mockCodeAssistServer),
      }),
    } as unknown as Config;

    const { result } = renderHook(() => usePrivacySettings(testConfig));

    await waitFor(() => {
      expect(result.current.privacyState.isLoading).toBe(false);
    });

    expect(result.current.privacyState.error).toBeUndefined();
    expect(result.current.privacyState.isFreeTier).toBe(false);
    expect(result.current.privacyState.dataCollectionOptIn).toBeUndefined();
  });

  it('should throw error when CodeAssistServer has no projectId', async () => {
    const mockCodeAssistServer = {
      projectId: undefined, // Explicitly set projectId to undefined
      loadCodeAssist: vi.fn().mockResolvedValue({
        currentTier: { id: UserTierId.FREE },
      } as LoadCodeAssistResponse),
    } as unknown as CodeAssistServer;

    const testConfig = {
      getGeminiClient: vi.fn().mockReturnValue({
        getContentGenerator: vi.fn().mockReturnValue(mockCodeAssistServer),
      }),
    } as unknown as Config;

    const { result } = renderHook(() => usePrivacySettings(testConfig));

    await waitFor(() => {
      expect(result.current.privacyState.isLoading).toBe(false);
    });

    expect(result.current.privacyState.error).toBe(
      'CodeAssist server is missing a project ID',
    );
  });

  it('should update data collection opt-in setting', async () => {
    const mockCodeAssistServer = {
      projectId: 'test-project-id',
      getCodeAssistGlobalUserSetting: vi.fn().mockResolvedValue({
        freeTierDataCollectionOptin: true,
      }),
      setCodeAssistGlobalUserSetting: vi.fn().mockResolvedValue({
        freeTierDataCollectionOptin: false,
      }),
      loadCodeAssist: vi.fn().mockResolvedValue({
        currentTier: { id: UserTierId.FREE },
      } as LoadCodeAssistResponse),
    } as unknown as CodeAssistServer;

    const testConfig = {
      getGeminiClient: vi.fn().mockReturnValue({
        getContentGenerator: vi.fn().mockReturnValue(mockCodeAssistServer),
      }),
    } as unknown as Config;

    const { result } = renderHook(() => usePrivacySettings(testConfig));

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.privacyState.isLoading).toBe(false);
    });

    // Update the setting
    await result.current.updateDataCollectionOptIn(false);

    // Wait for update to complete
    await waitFor(() => {
      expect(result.current.privacyState.dataCollectionOptIn).toBe(false);
    });

    expect(
      mockCodeAssistServer.setCodeAssistGlobalUserSetting,
    ).toHaveBeenCalledWith({
      cloudaicompanionProject: 'test-project-id',
      freeTierDataCollectionOptin: false,
    });
  });
});
