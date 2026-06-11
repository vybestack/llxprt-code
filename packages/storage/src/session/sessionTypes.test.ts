/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for session types.
 *
 * @plan PLAN-20260609-ISSUE1590.P04b
 */

import { describe, it, expect } from 'vitest';
import {
  SESSION_FILE_PREFIX,
  type ConversationRecord,
  type BaseMessageRecord,
  type ToolCallRecord,
} from './sessionTypes.js';

// Scenario 3: Root barrel import — verifies P04d barrel export.
// NOTE: Package self-import '@vybestack/llxprt-code-storage' does not resolve at vitest runtime
// without a built dist/ or vite alias. Using source-relative barrel import instead.
// The barrel (src/index.ts) re-exports these symbols, which is verified by typecheck and
// the structural presence checks in P04d verification commands.
import {
  SESSION_FILE_PREFIX as BARREL_PREFIX,
  type ConversationRecord as BarrelConversationRecord,
} from '../index.js';

// ─── Session Constants ───────────────────────────────────────────────────────

describe('Session Types — Constants', () => {
  it('SESSION_FILE_PREFIX is "session-"', () => {
    expect(SESSION_FILE_PREFIX).toBe('session-');
  });
});

// ─── Type Shape Assertions ───────────────────────────────────────────────────

describe('Session Types — Type Shape Assertions', () => {
  it('ConversationRecord satisfies the expected interface shape', () => {
    const record: ConversationRecord = {
      id: 'test-id',
      sessionId: 'session-123',
      timestamp: '2025-01-01T00:00:00.000Z',
      startTime: '2025-01-01T00:00:00.000Z',
      messages: [],
    };
    expect(record.id).toBe('test-id');
    expect(record.sessionId).toBe('session-123');
    expect(record.messages).toStrictEqual([]);
  });

  it('BaseMessageRecord satisfies the expected interface shape', () => {
    const msg: BaseMessageRecord = {
      id: 'msg-1',
      timestamp: '2025-01-01T00:00:00.000Z',
      role: 'user',
      content: 'hello',
    };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
  });

  it('ToolCallRecord satisfies the expected interface shape', () => {
    const toolCall: ToolCallRecord = {
      toolName: 'read_file',
      args: { path: '/tmp/test.txt' },
    };
    expect(toolCall.toolName).toBe('read_file');
    expect(toolCall.args).toStrictEqual({ path: '/tmp/test.txt' });
  });

  it('ConversationRecord with nested messages satisfies the interface', () => {
    const record: ConversationRecord = {
      id: 'conv-1',
      sessionId: 'session-456',
      timestamp: '2025-01-01T00:00:00.000Z',
      startTime: '2025-01-01T00:00:00.000Z',
      lastUpdated: '2025-01-01T00:01:00.000Z',
      messages: [
        {
          id: 'msg-1',
          timestamp: '2025-01-01T00:00:00.000Z',
          role: 'user',
          content: 'hello',
          toolCalls: [{ toolName: 'read_file', args: { path: 'README.md' } }],
        },
        {
          id: 'msg-2',
          timestamp: '2025-01-01T00:00:30.000Z',
          role: 'model',
          content: 'response',
        },
      ],
    };
    expect(record.messages).toHaveLength(2);
    expect(record.messages[0].toolCalls).toHaveLength(1);
    expect(record.lastUpdated).toBeDefined();
  });
});

// ─── Root Barrel Import (Scenario 3) ─────────────────────────────────────────

describe('Session Types — Root Barrel Import', () => {
  it('SESSION_FILE_PREFIX is accessible from root barrel with correct value', () => {
    expect(BARREL_PREFIX).toBe('session-');
    expect(BARREL_PREFIX).toBe(SESSION_FILE_PREFIX);
  });

  it('ConversationRecord type is accessible from root barrel', () => {
    const record: BarrelConversationRecord = {
      id: 'barrel-test',
      sessionId: 'session-barrel',
      timestamp: '2025-01-01T00:00:00.000Z',
      startTime: '2025-01-01T00:00:00.000Z',
      messages: [],
    };
    expect(record.id).toBe('barrel-test');
  });
});
