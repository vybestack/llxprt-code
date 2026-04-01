/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { GenerateContentResponse } from '@google/genai';
import {
  AgentExecutionStoppedError,
  AgentExecutionBlockedError,
} from '../geminiChat.js';

describe('AgentExecutionStoppedError', () => {
  it('should store reason and systemMessage', () => {
    const error = new AgentExecutionStoppedError('test reason', 'test system');
    expect(error.reason).toBe('test reason');
    expect(error.systemMessage).toBe('test system');
    expect(error.contextCleared).toBeUndefined();
    expect(error.message).toContain('test system');
    expect(error.name).toBe('AgentExecutionStoppedError');
  });

  it('should store contextCleared when provided', () => {
    const error = new AgentExecutionStoppedError('reason', 'system msg', true);
    expect(error.reason).toBe('reason');
    expect(error.systemMessage).toBe('system msg');
    expect(error.contextCleared).toBe(true);
  });

  it('should default contextCleared to undefined when not provided', () => {
    const error = new AgentExecutionStoppedError('reason');
    expect(error.contextCleared).toBeUndefined();
  });

  it('should allow contextCleared=false explicitly', () => {
    const error = new AgentExecutionStoppedError('reason', undefined, false);
    expect(error.contextCleared).toBe(false);
  });

  it('should use reason in message when no systemMessage', () => {
    const error = new AgentExecutionStoppedError('my reason');
    expect(error.message).toContain('my reason');
  });
});

describe('AgentExecutionBlockedError', () => {
  it('should store reason, syntheticResponse, and systemMessage', () => {
    const synthetic = { candidates: [] } as unknown as GenerateContentResponse;
    const error = new AgentExecutionBlockedError(
      'block reason',
      synthetic,
      'block system',
    );
    expect(error.reason).toBe('block reason');
    expect(error.syntheticResponse).toBe(synthetic);
    expect(error.systemMessage).toBe('block system');
    expect(error.contextCleared).toBeUndefined();
    expect(error.name).toBe('AgentExecutionBlockedError');
  });

  it('should store contextCleared when provided', () => {
    const error = new AgentExecutionBlockedError(
      'reason',
      undefined,
      'system',
      true,
    );
    expect(error.reason).toBe('reason');
    expect(error.systemMessage).toBe('system');
    expect(error.contextCleared).toBe(true);
  });

  it('should default contextCleared to undefined when not provided', () => {
    const error = new AgentExecutionBlockedError('reason');
    expect(error.contextCleared).toBeUndefined();
  });

  it('should allow contextCleared=false explicitly', () => {
    const error = new AgentExecutionBlockedError(
      'reason',
      undefined,
      undefined,
      false,
    );
    expect(error.contextCleared).toBe(false);
  });

  it('should use systemMessage in message when provided', () => {
    const error = new AgentExecutionBlockedError(
      'reason',
      undefined,
      'system msg',
    );
    expect(error.message).toContain('system msg');
  });
});
