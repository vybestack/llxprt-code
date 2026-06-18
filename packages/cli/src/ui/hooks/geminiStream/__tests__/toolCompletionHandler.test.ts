/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Unit tests for toolCompletionHandler.ts display-side helpers.
 *
 * Tests: classifyCompletedTools (CLI filter + engine delegation),
 * processMemoryToolResults, and the engine buildToolResponses helper
 * consumed by the loop.
 */

import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Part } from '@google/genai';
import { DEFAULT_AGENT_ID } from '@vybestack/llxprt-code-core/core/turn.js';
import type {
  TrackedToolCall,
  TrackedCompletedToolCall,
} from '../../useReactToolScheduler.js';
import {
  classifyCompletedTools,
  processMemoryToolResults,
} from '../toolCompletionHandler.js';
import { buildToolResponses } from '@vybestack/llxprt-code-agents';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const functionCallPart: Part = {
  functionCall: { name: 'test_tool', args: {} },
};
const functionResponsePart: Part = {
  functionResponse: { name: 'test_tool', response: { result: 'ok' } },
};
const textPart: Part = { text: 'some text output' };

function makeCompletedTool(overrides: {
  callId: string;
  agentId?: string;
  name?: string;
  responseParts?: Part[];
  isClientInitiated?: boolean;
  prompt_id?: string;
  status?: 'success' | 'error';
}): TrackedCompletedToolCall {
  return {
    request: {
      callId: overrides.callId,
      name: overrides.name ?? 'test_tool',
      args: {},
      isClientInitiated: overrides.isClientInitiated ?? false,
      prompt_id: overrides.prompt_id ?? 'prompt-1',
      agentId: overrides.agentId ?? DEFAULT_AGENT_ID,
    },
    status: overrides.status ?? 'success',
    displayCleared: false,
    response: {
      callId: overrides.callId,
      responseParts: overrides.responseParts ?? [functionResponsePart],
      resultDisplay: undefined,
      error: undefined,
      errorType: undefined,
    },
    invocation: { getDescription: () => 'test' } as any,
    tool: {
      name: overrides.name ?? 'test_tool',
      displayName: 'Test',
      description: 'test',
      build: vi.fn(),
    } as any,
  } as TrackedCompletedToolCall;
}

// ─── classifyCompletedTools ───────────────────────────────────────────────────

describe('classifyCompletedTools', () => {
  it('classifies primary tools (DEFAULT_AGENT_ID)', () => {
    const tool = makeCompletedTool({
      callId: 'call-1',
      agentId: DEFAULT_AGENT_ID,
    });
    const result = classifyCompletedTools([tool]);
    expect(result.primaryTools).toHaveLength(1);
    expect(result.externalTools).toHaveLength(0);
    expect(result.primaryTools[0].request.callId).toBe('call-1');
  });

  it('classifies external tools (non-DEFAULT_AGENT_ID)', () => {
    const tool = makeCompletedTool({
      callId: 'sub-call',
      agentId: 'subagent-1',
    });
    const result = classifyCompletedTools([tool]);
    expect(result.primaryTools).toHaveLength(0);
    expect(result.externalTools).toHaveLength(1);
    expect(result.externalTools[0].request.callId).toBe('sub-call');
  });

  it('handles mixed primary and external tools', () => {
    const primary = makeCompletedTool({
      callId: 'primary',
      agentId: DEFAULT_AGENT_ID,
    });
    const external = makeCompletedTool({
      callId: 'external',
      agentId: 'subagent-1',
    });
    const result = classifyCompletedTools([primary, external]);
    expect(result.primaryTools).toHaveLength(1);
    expect(result.externalTools).toHaveLength(1);
  });

  it('returns empty arrays for empty input', () => {
    const result = classifyCompletedTools([]);
    expect(result.primaryTools).toHaveLength(0);
    expect(result.externalTools).toHaveLength(0);
  });

  it('filters out non-terminal state tools (e.g. executing)', () => {
    const executingTool: TrackedToolCall = {
      request: {
        callId: 'exec-1',
        name: 'test_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'p1',
        agentId: DEFAULT_AGENT_ID,
      },
      status: 'executing',
      invocation: { getDescription: () => 'test' } as any,
      tool: {
        name: 'test_tool',
        displayName: 'Test',
        description: 'test',
        build: vi.fn(),
      } as any,
    } as TrackedToolCall;
    const result = classifyCompletedTools([executingTool]);
    expect(result.primaryTools).toHaveLength(0);
  });

  it('filters out terminal tools with no responseParts', () => {
    const toolWithNoResponse = makeCompletedTool({
      callId: 'no-response',
      responseParts: undefined as any,
    });
    // Force undefined responseParts
    (toolWithNoResponse.response as any).responseParts = undefined;
    const result = classifyCompletedTools([toolWithNoResponse]);
    expect(result.primaryTools).toHaveLength(0);
  });

  it('uses DEFAULT_AGENT_ID when agentId is undefined', () => {
    const tool = makeCompletedTool({ callId: 'call-1' });
    // Force agentId to undefined to exercise the fallback in classifyCompletedTools
    (tool.request as any).agentId = undefined;
    const result = classifyCompletedTools([tool]);
    expect(result.primaryTools).toHaveLength(1);
    expect(result.externalTools).toHaveLength(0);
  });
});

// ─── buildToolResponses ───────────────────────────────────────────────────────

describe('buildToolResponses', () => {
  it('includes functionResponse parts', () => {
    const tool = makeCompletedTool({
      callId: 'call-1',
      responseParts: [functionResponsePart],
    });
    const result = buildToolResponses([tool]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('functionResponse');
  });

  it('excludes functionCall parts', () => {
    const tool = makeCompletedTool({
      callId: 'call-1',
      responseParts: [functionCallPart, functionResponsePart],
    });
    const result = buildToolResponses([tool]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('functionResponse');
    expect(result[0]).not.toHaveProperty('functionCall');
  });

  it('includes text/other parts', () => {
    const tool = makeCompletedTool({
      callId: 'call-1',
      responseParts: [textPart],
    });
    const result = buildToolResponses([tool]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('text');
  });

  it('handles multiple tools', () => {
    const tool1 = makeCompletedTool({
      callId: 'c1',
      responseParts: [functionResponsePart],
    });
    const tool2 = makeCompletedTool({
      callId: 'c2',
      responseParts: [functionResponsePart],
    });
    const result = buildToolResponses([tool1, tool2]);
    expect(result).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(buildToolResponses([])).toHaveLength(0);
  });
});

// ─── processMemoryToolResults ─────────────────────────────────────────────────

describe('processMemoryToolResults', () => {
  let mockPerformMemoryRefresh: ReturnType<typeof vi.fn>;
  let processedMemoryToolsRef: React.MutableRefObject<Set<string>>;

  beforeEach(() => {
    mockPerformMemoryRefresh = vi.fn().mockResolvedValue(undefined);
    processedMemoryToolsRef = { current: new Set<string>() };
  });

  it('calls performMemoryRefresh for a new successful save_memory', () => {
    const tool = makeCompletedTool({
      callId: 'mem-1',
      name: 'save_memory',
    });
    processMemoryToolResults(
      [tool],
      processedMemoryToolsRef,
      mockPerformMemoryRefresh,
    );
    expect(mockPerformMemoryRefresh).toHaveBeenCalledOnce();
  });

  it('does NOT call refresh for already-processed save_memory', () => {
    processedMemoryToolsRef.current.add('mem-1');
    const tool = makeCompletedTool({
      callId: 'mem-1',
      name: 'save_memory',
    });
    processMemoryToolResults(
      [tool],
      processedMemoryToolsRef,
      mockPerformMemoryRefresh,
    );
    expect(mockPerformMemoryRefresh).not.toHaveBeenCalled();
  });

  it('marks newly processed memory tools in the ref', () => {
    const tool = makeCompletedTool({ callId: 'mem-2', name: 'save_memory' });
    processMemoryToolResults(
      [tool],
      processedMemoryToolsRef,
      mockPerformMemoryRefresh,
    );
    expect(processedMemoryToolsRef.current.has('mem-2')).toBe(true);
  });

  it('does NOT refresh for failed save_memory', () => {
    const failedTool = makeCompletedTool({
      callId: 'mem-3',
      name: 'save_memory',
    });
    (failedTool as any).status = 'error';
    processMemoryToolResults(
      [failedTool],
      processedMemoryToolsRef,
      mockPerformMemoryRefresh,
    );
    expect(mockPerformMemoryRefresh).not.toHaveBeenCalled();
  });

  it('does NOT refresh for non-memory tools', () => {
    const tool = makeCompletedTool({ callId: 'file-1', name: 'read_file' });
    processMemoryToolResults(
      [tool],
      processedMemoryToolsRef,
      mockPerformMemoryRefresh,
    );
    expect(mockPerformMemoryRefresh).not.toHaveBeenCalled();
  });

  it('calls refresh once for multiple new save_memory successes', () => {
    const t1 = makeCompletedTool({ callId: 'm1', name: 'save_memory' });
    const t2 = makeCompletedTool({ callId: 'm2', name: 'save_memory' });
    processMemoryToolResults(
      [t1, t2],
      processedMemoryToolsRef,
      mockPerformMemoryRefresh,
    );
    expect(mockPerformMemoryRefresh).toHaveBeenCalledOnce();
    expect(processedMemoryToolsRef.current.has('m1')).toBe(true);
    expect(processedMemoryToolsRef.current.has('m2')).toBe(true);
  });
});
