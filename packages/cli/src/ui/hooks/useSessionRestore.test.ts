/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertDefined } from '../../test-utils/assertions.js';

interface MockHistoryService {
  clear: ReturnType<typeof vi.fn>;
  validateAndFix: ReturnType<typeof vi.fn>;
  addAll: ReturnType<typeof vi.fn>;
}

interface MockAgentClient {
  resetChat: ReturnType<typeof vi.fn>;
  getHistoryService: () => MockHistoryService | null;
}

interface MockConfig {
  getAgentClient: () => MockAgentClient | undefined;
}

describe('Session Restore Chat Initialization', () => {
  let mockAgentClient: MockAgentClient;
  let mockConfig: MockConfig;
  let mockHistoryService: MockHistoryService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockHistoryService = {
      clear: vi.fn(),
      validateAndFix: vi.fn(),
      addAll: vi.fn(),
    };

    mockAgentClient = {
      resetChat: vi.fn().mockResolvedValue(undefined),
      getHistoryService: () => mockHistoryService,
    };

    mockConfig = {
      getAgentClient: () => mockAgentClient,
    };
  });

  describe('chat initialization when restoring session', () => {
    it('calls resetChat to ensure historyService is available', async () => {
      expect(mockAgentClient.resetChat).not.toHaveBeenCalled();

      const agentClient = mockConfig.getAgentClient();
      assertDefined(agentClient);
      await agentClient.resetChat();

      expect(mockAgentClient.resetChat).toHaveBeenCalled();
      expect(agentClient.getHistoryService()).toBeDefined();
    });

    it('handles resetChat errors gracefully without throwing', async () => {
      mockAgentClient.resetChat.mockRejectedValue(
        new Error('Failed to initialize chat'),
      );

      const agentClient = mockConfig.getAgentClient();
      assertDefined(agentClient);

      await expect(
        agentClient.resetChat().catch(() => {}),
      ).resolves.toBeUndefined();

      expect(mockAgentClient.resetChat).toHaveBeenCalled();
    });

    it('does not throw when agentClient is undefined', () => {
      mockConfig = {
        getAgentClient: () => undefined,
      };

      const agentClient = mockConfig.getAgentClient();

      expect(agentClient).toBeUndefined();
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

      const agentClient = mockConfig.getAgentClient();
      assertDefined(agentClient);

      await agentClient.resetChat();
      const historyService = agentClient.getHistoryService();
      assertDefined(historyService);
      historyService.addAll(restoredSessionHistory);

      expect(mockHistoryService.addAll).toHaveBeenCalledWith(
        restoredSessionHistory,
      );
    });

    it('continues session restore even if resetChat fails', async () => {
      mockAgentClient.resetChat.mockRejectedValue(
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

      const agentClient = mockConfig.getAgentClient();
      assertDefined(agentClient);

      await agentClient.resetChat().catch(() => {});
      const historyService = agentClient.getHistoryService();
      assertDefined(historyService);
      historyService.addAll(restoredSessionHistory);

      expect(mockAgentClient.resetChat).toHaveBeenCalled();
      expect(mockHistoryService.addAll).toHaveBeenCalledWith(
        restoredSessionHistory,
      );
    });
  });
});
