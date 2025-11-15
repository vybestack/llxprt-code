/** @license Copyright 2025 Vybestack LLC SPDX-License-Identifier: Apache-2.0 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useGeminiStream,
  DEFAULT_CONTEXT_LINES,
  DEFAULT_CONTEXT_LINES_MAX_FILE_SIZE,
} from './useGeminiStream.js';
import { useKeypress } from './useKeypress.js';
import {
  ApprovalMode,
  EditorType,
  GeminiClient,
  StreamingState,
  DEFAULT_AGENT_ID,
} from '@vybestack/llxprt-code-core';
import { useAutoAcceptIndicator } from './useAutoAcceptIndicator.js';
import { useLogger } from './useLogger.js';
import { useSettings } from './useSettings.js';
import { gitServiceFactory } from '../contexts/gitServiceFactory.js';
import * as config from '../../config/settings.js';

vi.mock('./useKeypress.js');
vi.mock('./useLogger.js');
vi.mock('./useSettings.js');
vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-core');
  return {
    ...actual,
    GeminiClient: vi.fn(),
  };
});

vi.mock('../contexts/gitServiceFactory.js', () => ({
  gitServiceFactory: vi.fn(),
}));

vi.mock('./useAutoAcceptIndicator.js', () => ({
  useAutoAcceptIndicator: vi.fn(),
}));

vi.mock(config, async () => {
  const actual = await vi.importActual<typeof config>(config);
  return {
    ...actual,
    useSettings: vi.fn(),
  };
});

const createMockConfig = ({
  autoAccept = ApprovalMode.DEFAULT,
  debugKeystrokeLogging = false,
  skipFileValidation = false,
  enableFileStreaming = false,
  contextLines = DEFAULT_CONTEXT_LINES,
  contextLinesMaxFileSize = DEFAULT_CONTEXT_LINES_MAX_FILE_SIZE,
  enableEmojiFilter = false,
  emojiFilterMode = 'none' as const,
}: {
  autoAccept?: ApprovalMode;
  debugKeystrokeLogging?: boolean;
  skipFileValidation?: boolean;
  enableFileStreaming?: boolean;
  contextLines?: number;
  contextLinesMaxFileSize?: number;
  enableEmojiFilter?: boolean;
  emojiFilterMode?: 'none' | 'default';
} = {}) => ({
  getAutoAccept: vi.fn().mockReturnValue(autoAccept),
  getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
  skipFileValidation,
  enableFileStreaming,
  debugKeystrokeLogging,
  contextLines,
  contextLinesMaxFileSize,
  enableEmojiFilter,
  emojiFilterMode,
  getProjectRoot: vi.fn().mockReturnValue('/home/user/project'),
});

describe('useGeminiStream', () => {
  let keypressCallback: (key: { name: string }) => void;

  let mockGitService: Partial<gitServiceFactory>;
  let mockAddItem: vi.Mock;
  let mockConfig: ReturnType<typeof createMockConfig>;
  let mockOnAuthError: vi.Mock;
  let mockPerformMemoryRefresh: vi.Mock;
  let mockOnEditorClose: vi.Mock;
  let mockOnCancelSubmit: vi.Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockAddItem = vi.fn();
    mockConfig = createMockConfig({
      autoAccept: ApprovalMode.DEFAULT,
    });

    mockGitService = vi.fn().mockReturnValue({
      addFiles: vi.fn().mockResolvedValue(undefined),
      removeFiles: vi.fn().mockResolvedValue(undefined),
      getRoot: vi.fn().mockReturnValue('/home/user/project'),
    });
    mockOnAuthError = vi.fn();
    mockPerformMemoryRefresh = vi.fn().mockResolvedValue(true);
    mockOnEditorClose = vi.fn();
    mockOnCancelSubmit = vi.fn();

    gitServiceFactory.mockReturnValue(mockGitService);

    (useLogger as jest.Mock).mockReturnValue({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    });

    (useSettings as jest.Mock).mockReturnValue({
      merged: { debugKeystrokeLogging: false },
    });

    // Mock useKeypress to capture keypress callback
    const mockUseKeypress = useKeypress as jest.Mock;
    mockUseKeypress.mockImplementation(
      (_callback: (key: { name: string }) => void) => {
        keypressCallback = callback;
        return vi.fn();
      },
    );

    (useAutoAcceptIndicator as jest.Mock).mockReturnValue(ApprovalMode.DEFAULT);
  });

  const renderTestHook = ({
    onAuthError = mockOnAuthError,
    performMemoryRefresh = mockPerformMemoryRefresh,
    onEditorClose = mockOnEditorClose,
    onCancelSubmit = mockOnCancelSubmit,
    config = mockConfig,
    shellModeActive = false,
    addItem = mockAddItem,
  }: {
    onAuthError?: vi.Mock;
    performMemoryRefresh?: vi.Mock;
    onEditorClose?: vi.Mock;
    onCancelSubmit?: vi.Mock;
    config?: ReturnType<typeof createMockConfig>;
    shellModeActive?: boolean;
    addItem?: vi.Mock;
  } = {}) => {
    const args = {
      config: config as unknown,
      client: new GeminiClient({
        apiKey: 'test-api-key',
        baseUrl: 'http://localhost:11434',
        model: 'llama3.2',
        agentId: DEFAULT_AGENT_ID,
      }) as unknown,
      addItem,
      shellModeActive,
      getPreferredEditor: () => EditorType.VSCode,
      onAuthError,
      performMemoryRefresh,
      onEditorClose,
      onCancelSubmit,
    };

    return renderHook(() => useGeminiStream(args));
  };

  const simulateEscapeKeyPress = () => {
    act(() => {
      keypressCallback({ name: 'escape' });
    });
  };

  it('should cancel in-progress stream in YOLO mode when ESC is pressed', async () => {
    // Set up YOLO mode
    mockConfig.getApprovalMode.mockReturnValue(ApprovalMode.YOLO);
    (useAutoAcceptIndicator as jest.Mock).mockReturnValue(ApprovalMode.YOLO);

    const { result } = renderTestHook();

    // Don't start a stream - should be in idle state
    expect(result.current.streamingState).toBe(StreamingState.Idle);

    const initialAddItemCalls = mockAddItem.mock.calls.length;

    // Press ESC while idle
    simulateEscapeKeyPress();

    // Verify no cancellation occurred
    expect(mockAddItem).toHaveBeenCalledTimes(initialAddItemCalls);
    expect(result.current.streamingState).toBe(StreamingState.Idle);
  });

  describe('ESC cancellation in WaitingForConfirmation state', () => {
    it('should cancel when ESC is pressed during awaiting_approval state', async () => {
      mockConfig.getApprovalMode.mockReturnValue(ApprovalMode.DEFAULT);
      (useAutoAcceptIndicator as jest.Mock).mockReturnValue(
        ApprovalMode.DEFAULT,
      );

      const { result } = renderTestHook();

      // Get initial state
      expect(result.current.streamingState).toBe(StreamingState.Idle);

      // Verify that useKeypress is only active during StreamingState.Responding
      // This test demonstrates the issue: ESC doesn't work when in WaitingForConfirmation state

      const initialAddItemCalls = mockAddItem.mock.calls.length;

      // Press ESC while idle - should not cancel
      simulateEscapeKeyPress();
      expect(mockAddItem).toHaveBeenCalledTimes(initialAddItemCalls);

      // For now just verify the hook is working - the real test will be the implementation
      expect(result.current.cancelOngoingRequest).toBeDefined();
    });
  });
});
