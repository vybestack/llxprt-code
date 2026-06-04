/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test to verify circular reference handling in telemetry logging
 */

import { describe, it, expect } from 'vitest';
import { logToolCall } from './loggers.js';
import { ToolCallEvent } from './types.js';
import type { Config } from '../config/config.js';
import { type CompletedToolCall } from '../core/coreToolScheduler.js';
import {
  type ToolCallRequestInfo,
  type ToolCallResponseInfo,
} from '../core/turn.js';
import { MockTool } from '../test-utils/tools.js';

function buildMockConfig(): Config {
  return {
    getTelemetryEnabled: () => true,
    getUsageStatisticsEnabled: () => true,
    getSessionId: () => 'test-session',
    getModel: () => 'test-model',
    getEmbeddingModel: () => 'test-embedding',
    getDebugMode: () => false,
  } as unknown as Config;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCircularObject(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const circularObject: any = {
    sockets: {},
    agent: null,
  };
  circularObject.agent = circularObject;
  circularObject.sockets['test-host'] = [
    { _httpMessage: { agent: circularObject } },
  ];
  return circularObject;
}

function buildMockRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
): ToolCallRequestInfo {
  return {
    callId: 'test-call-id',
    name: 'ReadFile',
    args,
    isClientInitiated: false,
    prompt_id: 'test-prompt-id',
    agentId: 'agent-circular',
  };
}

function buildMockResponse(): ToolCallResponseInfo {
  return {
    callId: 'test-call-id',
    responseParts: [{ text: 'test result' }],
    resultDisplay: undefined,
    error: undefined,
    errorType: undefined,
    agentId: 'agent-circular',
  };
}

function buildMockCompletedToolCall(
  request: ToolCallRequestInfo,
): CompletedToolCall {
  const tool = new MockTool('mock-tool');
  return {
    status: 'success',
    request,
    response: buildMockResponse(),
    tool,
    invocation: tool.build({}),
    durationMs: 100,
  };
}

describe('Circular Reference Handling', () => {
  it('should handle circular references in tool function arguments', () => {
    const mockConfig = buildMockConfig();
    const circularObject = buildCircularObject();

    const mockRequest = buildMockRequest(circularObject);
    const mockCompletedToolCall = buildMockCompletedToolCall(mockRequest);
    const event = new ToolCallEvent(mockCompletedToolCall);

    expect(() => {
      logToolCall(mockConfig, event);
    }).not.toThrow();
  });

  it('should handle normal objects without circular references', () => {
    const mockConfig = buildMockConfig();
    const normalObject = {
      filePath: '/test/path',
      options: { encoding: 'utf8' },
    };

    const mockRequest = buildMockRequest(normalObject);
    const mockCompletedToolCall = buildMockCompletedToolCall(mockRequest);
    const event = new ToolCallEvent(mockCompletedToolCall);

    expect(() => {
      logToolCall(mockConfig, event);
    }).not.toThrow();
  });
});
