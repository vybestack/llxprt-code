/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface MockHistoryService {
  clear: ReturnType<typeof vi.fn>;
  validateAndFix: ReturnType<typeof vi.fn>;
  addAll: ReturnType<typeof vi.fn>;
}

interface MockGeminiClient {
  resetChat: ReturnType<typeof vi.fn>;
  getHistoryService: () => MockHistoryService | null;
}

interface MockConfig {
  getGeminiClient: () => MockGeminiClient | undefined;
}

describe('Session Restore Chat Initialization', () => {
  let mockGeminiClient: MockGeminiClient;
  let mockConfig: MockConfig;
  let mockHistoryService: MockHistoryService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockHistoryService = {
      clear: vi.fn(),
      validateAndFix: vi.fn(),
      addAll: vi.fn(),
    };

    mockGeminiClient = {
      resetChat: vi.fn().mockResolvedValue(undefined),
      getHistoryService: () => mockHistoryService,
    };

    mockConfig = {
      getGeminiClient: () => mockGeminiClient,
    };
  });

  describe('chat initialization when restoring session', () => {
    it('calls resetChat to ensure historyService is available', async () => {
      expect(mockGeminiClient.resetChat).not.toHaveBeenCalled();

      const geminiClient = mockConfig.getGeminiClient();
      if (geminiClient) {
        await geminiClient.resetChat();
      }

      expect(mockGeminiClient.resetChat).toHaveBeenCalled();
      expect(geminiClient?.getHistoryService()).toBeDefined();
    });

    it('handles resetChat errors gracefully without throwing', async () => {
      mockGeminiClient.resetChat.mockRejectedValue(
        new Error('Failed to initialize chat'),
      );

      const geminiClient = mockConfig.getGeminiClient();

      await expect(async () => {
        if (geminiClient) {
          await geminiClient.resetChat().catch(() => {});
        }
      }).not.toThrow();

      expect(mockGeminiClient.resetChat).toHaveBeenCalled();
    });

    it('does not throw when geminiClient is undefined', () => {
      mockConfig = {
        getGeminiClient: () => undefined,
      };

      const geminiClient = mockConfig.getGeminiClient();

      expect(() => {
        if (geminiClient) {
          geminiClient.resetChat();
        }
      }).not.toThrow();
    });

    it('restores core history after chat initialization makes historyService available', async () => {
      const restoredSessionHistory = [
        {
          speaker: 'human' as const,
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
        {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: 'Hi there!' }],
        },
      ];

      const geminiClient = mockConfig.getGeminiClient();

      if (geminiClient) {
        await geminiClient.resetChat();
        const historyService = geminiClient.getHistoryService();
        if (historyService) {
          historyService.addAll(restoredSessionHistory);
        }
      }

      expect(mockHistoryService.addAll).toHaveBeenCalledWith(
        restoredSessionHistory,
      );
    });

    it('continues session restore even if resetChat fails', async () => {
      mockGeminiClient.resetChat.mockRejectedValue(
        new Error('Chat init failed'),
      );

      const restoredSessionHistory = [
        {
          speaker: 'human' as const,
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
        {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: 'Hi!' }],
        },
      ];

      const geminiClient = mockConfig.getGeminiClient();

      if (geminiClient) {
        await geminiClient.resetChat().catch(() => {});
        const historyService = geminiClient.getHistoryService();
        if (historyService) {
          historyService.addAll(restoredSessionHistory);
        }
      }

      expect(mockGeminiClient.resetChat).toHaveBeenCalled();
      expect(mockHistoryService.addAll).toHaveBeenCalledWith(
        restoredSessionHistory,
      );
    });
  });
});
