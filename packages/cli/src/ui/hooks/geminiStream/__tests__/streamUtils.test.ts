/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for streamUtils.ts pure utilities and config-bound helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinishReason } from '@google/genai';
import type { Part } from '@google/genai';
import { UnauthorizedError } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../../../config/settings.js';
import type { HistoryItemWithoutId } from '../../../types.js';
import { ToolCallStatus } from '../../../types.js';
import {
  mergePartListUnions,
  mergePendingToolGroupsForDisplay,
  splitPartsByRole,
  collectGeminiTools,
  buildFinishReasonMessage,
  deduplicateToolCallRequests,
  buildThinkingBlock,
  buildSplitContent,
  processSlashCommandResult,
  handleSubmissionError,
  showCitations,
  getCurrentProfileName,
  SYSTEM_NOTICE_EVENT,
} from '../streamUtils.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetCodeAssistServer = vi.hoisted(() => vi.fn());

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-core');
  return {
    ...actual,
    getCodeAssistServer: mockGetCodeAssistServer,
    parseAndFormatApiError: vi.fn((msg: string) => msg),
    getErrorMessage: vi.fn((e: unknown) => String(e)),
  };
});

vi.mock('../../../utils/markdownUtilities.js', async () => ({
  findLastSafeSplitPoint: vi.fn((text: string) => text.length),
}));

// ─── mergePartListUnions ──────────────────────────────────────────────────────

describe('mergePartListUnions', () => {
  it('merges string items into text parts', () => {
    const result = mergePartListUnions(['hello', 'world']);
    expect(result).toStrictEqual([{ text: 'hello' }, { text: 'world' }]);
  });

  it('merges Part objects directly', () => {
    const part: Part = { text: 'foo' };
    const result = mergePartListUnions([part]);
    expect(result).toStrictEqual([{ text: 'foo' }]);
  });

  it('merges arrays of string/Part', () => {
    const result = mergePartListUnions([['a', { text: 'b' }]]);
    expect(result).toStrictEqual([{ text: 'a' }, { text: 'b' }]);
  });

  it('returns empty array for empty input', () => {
    expect(mergePartListUnions([])).toStrictEqual([]);
  });

  it('flattens nested arrays', () => {
    const result = mergePartListUnions([['a', 'b'], ['c'], 'd']);
    expect(result).toStrictEqual([
      { text: 'a' },
      { text: 'b' },
      { text: 'c' },
      { text: 'd' },
    ]);
  });
});

// ─── mergePendingToolGroupsForDisplay ─────────────────────────────────────────

describe('mergePendingToolGroupsForDisplay', () => {
  const makeTool = (callId: string, name: string) => ({
    callId,
    name,
    description: 'test',
    status: ToolCallStatus.Executing,
    resultDisplay: undefined,
    confirmationDetails: undefined,
  });

  it('returns both items when neither is a tool_group', () => {
    const a: HistoryItemWithoutId = { type: 'gemini', text: 'hello' };
    const b: HistoryItemWithoutId = { type: 'gemini', text: 'world' };
    const result = mergePendingToolGroupsForDisplay(a, b);
    expect(result).toHaveLength(2);
  });

  it('filters out null/undefined', () => {
    const result = mergePendingToolGroupsForDisplay(null, undefined);
    expect(result).toHaveLength(0);
  });

  it('returns both items when tool groups have no overlapping callIds', () => {
    const a: HistoryItemWithoutId = {
      type: 'tool_group',
      agentId: 'primary',
      tools: [makeTool('call-1', 'read_file')],
    };
    const b: HistoryItemWithoutId = {
      type: 'tool_group',
      agentId: 'primary',
      tools: [makeTool('call-2', 'write_file')],
    };
    const result = mergePendingToolGroupsForDisplay(a, b);
    expect(result).toHaveLength(2);
  });

  it('deduplicates shell command tool (Shell Command) from scheduler group', () => {
    const shellCallId = 'shell-1';
    const a: HistoryItemWithoutId = {
      type: 'tool_group',
      agentId: 'primary',
      tools: [makeTool(shellCallId, 'Shell Command')],
    };
    const b: HistoryItemWithoutId = {
      type: 'tool_group',
      agentId: 'primary',
      tools: [makeTool(shellCallId, 'Shell Command')],
    };
    const result = mergePendingToolGroupsForDisplay(a, b);
    // Shell command from pendingHistoryItem takes precedence
    const allTools = result.flatMap(
      (r) => (r as { tools?: Array<{ callId: string }> }).tools ?? [],
    );
    const shellToolInstances = allTools.filter((t) => t.callId === shellCallId);
    expect(shellToolInstances).toHaveLength(1);
  });

  it('deduplicates non-shell overlapping tools between pending and scheduler groups', () => {
    const overlappingCallId = 'call-overlap';
    const a: HistoryItemWithoutId = {
      type: 'tool_group',
      agentId: 'primary',
      tools: [makeTool(overlappingCallId, 'read_file')],
    };
    const b: HistoryItemWithoutId = {
      type: 'tool_group',
      agentId: 'primary',
      tools: [makeTool(overlappingCallId, 'read_file')],
    };
    const result = mergePendingToolGroupsForDisplay(a, b);
    const allTools = result.flatMap(
      (r) => (r as { tools?: Array<{ callId: string }> }).tools ?? [],
    );
    const instances = allTools.filter((t) => t.callId === overlappingCallId);
    expect(instances).toHaveLength(1);
  });
});

// ─── splitPartsByRole ─────────────────────────────────────────────────────────

describe('splitPartsByRole', () => {
  it('separates functionCall parts into functionCalls array', () => {
    const parts: Part[] = [
      { functionCall: { name: 'foo', args: {} } },
      { text: 'hello' },
    ];
    const { functionCalls, functionResponses, otherParts } =
      splitPartsByRole(parts);
    expect(functionCalls).toHaveLength(1);
    expect(functionResponses).toHaveLength(0);
    expect(otherParts).toHaveLength(1);
  });

  it('separates functionResponse parts into functionResponses array', () => {
    const parts: Part[] = [
      { functionResponse: { name: 'foo', response: { result: 'ok' } } },
    ];
    const { functionCalls, functionResponses, otherParts } =
      splitPartsByRole(parts);
    expect(functionCalls).toHaveLength(0);
    expect(functionResponses).toHaveLength(1);
    expect(otherParts).toHaveLength(0);
  });

  it('handles empty array', () => {
    const { functionCalls, functionResponses, otherParts } = splitPartsByRole(
      [],
    );
    expect(functionCalls).toHaveLength(0);
    expect(functionResponses).toHaveLength(0);
    expect(otherParts).toHaveLength(0);
  });

  it('correctly separates mixed content', () => {
    const parts: Part[] = [
      { functionCall: { name: 'a', args: {} } },
      { functionResponse: { name: 'a', response: {} } },
      { text: 'text' },
      { functionCall: { name: 'b', args: {} } },
    ];
    const { functionCalls, functionResponses, otherParts } =
      splitPartsByRole(parts);
    expect(functionCalls).toHaveLength(2);
    expect(functionResponses).toHaveLength(1);
    expect(otherParts).toHaveLength(1);
  });
});

// ─── collectGeminiTools ───────────────────────────────────────────────────────

describe('collectGeminiTools', () => {
  it('filters out client-initiated tools', () => {
    const tools = [
      { request: { isClientInitiated: true, name: 'client-tool' } },
      { request: { isClientInitiated: false, name: 'gemini-tool' } },
      { request: { name: 'no-flag-tool' } },
    ];
    const result = collectGeminiTools(tools);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.request.name)).toStrictEqual([
      'gemini-tool',
      'no-flag-tool',
    ]);
  });

  it('returns all tools when none are client-initiated', () => {
    const tools = [
      { request: { isClientInitiated: false, name: 'a' } },
      { request: { isClientInitiated: false, name: 'b' } },
    ];
    expect(collectGeminiTools(tools)).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(collectGeminiTools([])).toHaveLength(0);
  });
});

// ─── buildFinishReasonMessage ─────────────────────────────────────────────────

describe('buildFinishReasonMessage', () => {
  it('returns undefined for STOP', () => {
    expect(buildFinishReasonMessage(FinishReason.STOP)).toBeUndefined();
  });

  it('returns undefined for FINISH_REASON_UNSPECIFIED', () => {
    expect(
      buildFinishReasonMessage(FinishReason.FINISH_REASON_UNSPECIFIED),
    ).toBeUndefined();
  });

  it('returns message for MAX_TOKENS', () => {
    expect(buildFinishReasonMessage(FinishReason.MAX_TOKENS)).toMatch(
      /truncated/i,
    );
  });

  it('returns message for SAFETY', () => {
    expect(buildFinishReasonMessage(FinishReason.SAFETY)).toMatch(/safety/i);
  });

  it('returns message for RECITATION', () => {
    expect(buildFinishReasonMessage(FinishReason.RECITATION)).toMatch(
      /recitation/i,
    );
  });

  it('returns message for MALFORMED_FUNCTION_CALL', () => {
    expect(
      buildFinishReasonMessage(FinishReason.MALFORMED_FUNCTION_CALL),
    ).toBeDefined();
  });
});

// ─── deduplicateToolCallRequests ──────────────────────────────────────────────

describe('deduplicateToolCallRequests', () => {
  const makeRequest = (callId: string) => ({
    callId,
    name: 'tool',
    args: {},
    isClientInitiated: false,
    prompt_id: 'p1',
    agentId: 'primary',
  });

  it('removes duplicate callIds', () => {
    const requests = [makeRequest('a'), makeRequest('b'), makeRequest('a')];
    const result = deduplicateToolCallRequests(requests);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.callId)).toStrictEqual(['a', 'b']);
  });

  it('preserves insertion order', () => {
    const requests = [
      makeRequest('c'),
      makeRequest('a'),
      makeRequest('b'),
      makeRequest('a'),
    ];
    const result = deduplicateToolCallRequests(requests);
    expect(result.map((r) => r.callId)).toStrictEqual(['c', 'a', 'b']);
  });

  it('returns empty for empty input', () => {
    expect(deduplicateToolCallRequests([])).toHaveLength(0);
  });

  it('returns all items when no duplicates', () => {
    const requests = [makeRequest('x'), makeRequest('y'), makeRequest('z')];
    expect(deduplicateToolCallRequests(requests)).toHaveLength(3);
  });
});

// ─── buildThinkingBlock ───────────────────────────────────────────────────────

describe('buildThinkingBlock', () => {
  it('creates a ThinkingBlock from thought text', () => {
    const block = buildThinkingBlock('my thought', []);
    expect(block).toStrictEqual({
      type: 'thinking',
      thought: 'my thought',
      sourceField: 'thought',
    });
  });

  it('returns null for empty thought text', () => {
    expect(buildThinkingBlock('', [])).toBeNull();
  });

  it('returns null if thought already exists in existingBlocks', () => {
    const existing = [
      {
        type: 'thinking' as const,
        thought: 'duplicate',
        sourceField: 'thought' as const,
      },
    ];
    expect(buildThinkingBlock('duplicate', existing)).toBeNull();
  });

  it('creates new block if thought is unique', () => {
    const existing = [
      {
        type: 'thinking' as const,
        thought: 'other',
        sourceField: 'thought' as const,
      },
    ];
    const block = buildThinkingBlock('new thought', existing);
    expect(block).not.toBeNull();
    expect(block?.thought).toBe('new thought');
  });
});

// ─── buildSplitContent ────────────────────────────────────────────────────────

describe('buildSplitContent', () => {
  beforeEach(() => {
    // findLastSafeSplitPoint is mocked to return text.length (no split)
    vi.resetModules();
  });

  it('returns fullTextItem when no split needed (splitPoint equals length)', () => {
    const result = buildSplitContent(
      'hello world',
      'myProfile',
      null,
      [],
      'gemini',
    );
    expect(result.splitPoint).toBe('hello world'.length);
    expect(result.beforeText).toBe('hello world');
    expect(result.afterText).toBe('');
    expect(result.fullTextItem.text).toBe('hello world');
    expect(result.fullTextItem.type).toBe('gemini');
  });

  it('includes profileName when provided', () => {
    const result = buildSplitContent('text', 'myProfile', null, [], 'gemini');
    expect(result.fullTextItem.profileName).toBe('myProfile');
    expect(result.afterItem.profileName).toBe('myProfile');
  });

  it('falls back to existingProfileName when liveProfileName is null', () => {
    const result = buildSplitContent(
      'text',
      null,
      'existingProfile',
      [],
      'gemini',
    );
    expect(result.fullTextItem.profileName).toBe('existingProfile');
    expect(result.afterItem.profileName).toBe('existingProfile');
  });

  it('prefers liveProfileName over existingProfileName', () => {
    const result = buildSplitContent(
      'text',
      'liveProfile',
      'existingProfile',
      [],
      'gemini',
    );
    expect(result.fullTextItem.profileName).toBe('liveProfile');
    expect(result.afterItem.profileName).toBe('liveProfile');
  });

  it('includes thinkingBlocks when provided', () => {
    const blocks = [
      {
        type: 'thinking' as const,
        thought: 'think',
        sourceField: 'thought' as const,
      },
    ];
    const result = buildSplitContent('text', null, null, blocks, 'gemini');
    expect(result.fullTextItem.thinkingBlocks).toHaveLength(1);
  });

  it('produces afterItem as gemini_content type', () => {
    const result = buildSplitContent('hello', null, null, [], 'gemini');
    expect(result.afterItem.type).toBe('gemini_content');
  });

  it('handles null profileName (no profileName property)', () => {
    const result = buildSplitContent('text', null, null, [], 'gemini');
    expect(result.fullTextItem.profileName).toBeUndefined();
  });
});

// ─── processSlashCommandResult ────────────────────────────────────────────────

describe('processSlashCommandResult', () => {
  const mockScheduleToolCalls = vi.fn().mockResolvedValue(undefined);
  const mockSignal = new AbortController().signal;

  beforeEach(() => {
    mockScheduleToolCalls.mockClear();
  });

  it('handles schedule_tool: calls scheduleToolCalls and returns no further proceed', async () => {
    const result = await processSlashCommandResult(
      {
        type: 'schedule_tool',
        toolName: 'my_tool',
        toolArgs: { key: 'value' },
      },
      mockScheduleToolCalls,
      'prompt-1',
      mockSignal,
    );
    expect(mockScheduleToolCalls).toHaveBeenCalledOnce();
    const calledWith = mockScheduleToolCalls.mock.calls[0][0];
    expect(calledWith[0].name).toBe('my_tool');
    expect(calledWith[0].isClientInitiated).toBe(true);
    expect(result.queryToSend).toBeNull();
    expect(result.shouldProceed).toBe(false);
  });

  it('handles submit_prompt: returns content to send', async () => {
    const content = 'processed query';
    const result = await processSlashCommandResult(
      { type: 'submit_prompt', content },
      mockScheduleToolCalls,
      'prompt-1',
      mockSignal,
    );
    expect(result.queryToSend).toBe(content);
    expect(result.shouldProceed).toBe(true);
  });

  it('handles handled: returns null, shouldProceed false', async () => {
    const result = await processSlashCommandResult(
      { type: 'handled' },
      mockScheduleToolCalls,
      'prompt-1',
      mockSignal,
    );
    expect(result.queryToSend).toBeNull();
    expect(result.shouldProceed).toBe(false);
  });
});

// ─── handleSubmissionError ────────────────────────────────────────────────────

describe('handleSubmissionError', () => {
  const mockAddItem = vi.fn();
  const mockOnAuthError = vi.fn();
  const mockConfig = {
    getModel: vi.fn(() => 'test-model'),
  } as unknown as Config;

  beforeEach(() => {
    mockAddItem.mockClear();
    mockOnAuthError.mockClear();
  });

  it('calls onAuthError and returns true for UnauthorizedError', () => {
    const err = new UnauthorizedError('Unauthorized');
    const result = handleSubmissionError(
      err,
      mockAddItem,
      mockConfig,
      mockOnAuthError,
      Date.now(),
    );
    expect(mockOnAuthError).toHaveBeenCalledOnce();
    expect(result).toBe(true);
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it('adds error item for generic errors and returns false', () => {
    const result = handleSubmissionError(
      new Error('Something broke'),
      mockAddItem,
      mockConfig,
      mockOnAuthError,
      Date.now(),
    );
    expect(result).toBe(false);
    expect(mockAddItem).toHaveBeenCalledOnce();
    const itemArg = mockAddItem.mock.calls[0][0];
    expect(itemArg.type).toBe('error');
  });

  it('does not add error item for AbortError (swallows it)', () => {
    const abortErr = Object.assign(new Error('abort'), {
      name: 'AbortError',
      code: 'ABORT_ERR',
    });
    const result = handleSubmissionError(
      abortErr,
      mockAddItem,
      mockConfig,
      mockOnAuthError,
      Date.now(),
    );
    expect(result).toBe(false);
    expect(mockAddItem).not.toHaveBeenCalled();
  });
});

// ─── showCitations ────────────────────────────────────────────────────────────

describe('showCitations', () => {
  const makeConfig = (overrides?: Record<string, unknown>): Config =>
    ({
      getSettingsService: vi.fn(() => null),
      ...overrides,
    }) as unknown as Config;

  const makeSettings = (showCitationsValue?: boolean): LoadedSettings =>
    ({
      merged: {
        ui: { showCitations: showCitationsValue },
      },
    }) as unknown as LoadedSettings;

  beforeEach(() => {
    mockGetCodeAssistServer.mockReturnValue(null);
  });

  it('returns true when settingsService.get returns true', () => {
    const mockSettingsService = { get: vi.fn(() => true) };
    const config = makeConfig({
      getSettingsService: vi.fn(() => mockSettingsService),
    });
    expect(showCitations(makeSettings(), config)).toBe(true);
  });

  it('returns false when settingsService.get returns false', () => {
    const mockSettingsService = { get: vi.fn(() => false) };
    const config = makeConfig({
      getSettingsService: vi.fn(() => mockSettingsService),
    });
    expect(showCitations(makeSettings(), config)).toBe(false);
  });

  it('falls through to settings.merged when settingsService.get returns undefined', () => {
    const mockSettingsService = { get: vi.fn(() => undefined) };
    const config = makeConfig({
      getSettingsService: vi.fn(() => mockSettingsService),
    });
    expect(showCitations(makeSettings(true), config)).toBe(true);
  });

  it('falls through to settings.merged when settingsService throws', () => {
    const config = makeConfig({
      getSettingsService: vi.fn(() => {
        throw new Error('unavailable');
      }),
    });
    expect(showCitations(makeSettings(false), config)).toBe(false);
  });

  it('falls through to settings.merged when settingsService returns null', () => {
    const config = makeConfig({ getSettingsService: vi.fn(() => null) });
    expect(showCitations(makeSettings(true), config)).toBe(true);
  });

  it('falls through to tier check when settings.merged.ui.showCitations is undefined', () => {
    const config = makeConfig({ getSettingsService: vi.fn(() => null) });
    // Non-FREE tier → true
    mockGetCodeAssistServer.mockReturnValue({ userTier: 'STANDARD' });
    expect(showCitations(makeSettings(), config)).toBe(true);
  });

  it('returns false when userTier is FREE', () => {
    const config = makeConfig({ getSettingsService: vi.fn(() => null) });
    mockGetCodeAssistServer.mockReturnValue({ userTier: 'free-tier' });
    expect(showCitations(makeSettings(), config)).toBe(false);
  });

  it('returns false when getCodeAssistServer returns undefined', () => {
    const config = makeConfig({ getSettingsService: vi.fn(() => null) });
    mockGetCodeAssistServer.mockReturnValue(undefined);
    expect(showCitations(makeSettings(), config)).toBe(false);
  });
});

// ─── getCurrentProfileName ────────────────────────────────────────────────────

describe('getCurrentProfileName', () => {
  const makeConfig = (overrides?: Record<string, unknown>): Config =>
    ({
      getSettingsService: vi.fn(() => null),
      ...overrides,
    }) as unknown as Config;

  it('returns profile name from settingsService.getCurrentProfileName', () => {
    const mockSettingsService = {
      getCurrentProfileName: vi.fn(() => 'custom-profile'),
    };
    const config = makeConfig({
      getSettingsService: vi.fn(() => mockSettingsService),
    });
    expect(getCurrentProfileName(config)).toBe('custom-profile');
  });

  it('returns null when settingsService.getCurrentProfileName returns null', () => {
    const mockSettingsService = { getCurrentProfileName: vi.fn(() => null) };
    const config = makeConfig({
      getSettingsService: vi.fn(() => mockSettingsService),
    });
    expect(getCurrentProfileName(config)).toBeNull();
  });

  it('returns null when settingsService returns null', () => {
    const config = makeConfig({ getSettingsService: vi.fn(() => null) });
    expect(getCurrentProfileName(config)).toBeNull();
  });

  it('returns null when getSettingsService throws', () => {
    const config = makeConfig({
      getSettingsService: vi.fn(() => {
        throw new Error('unavailable');
      }),
    });
    expect(getCurrentProfileName(config)).toBeNull();
  });

  it('returns null when settingsService has no getCurrentProfileName method', () => {
    const mockSettingsService = {}; // No getCurrentProfileName
    const config = makeConfig({
      getSettingsService: vi.fn(() => mockSettingsService),
    });
    expect(getCurrentProfileName(config)).toBeNull();
  });
});

// ─── SYSTEM_NOTICE_EVENT ──────────────────────────────────────────────────────

describe('SYSTEM_NOTICE_EVENT', () => {
  it('is the string system_notice', () => {
    expect(SYSTEM_NOTICE_EVENT).toBe('system_notice');
  });
});
