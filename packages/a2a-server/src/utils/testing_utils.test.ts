/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  createStreamMessageRequest,
  createConfirmationMessageRequest,
} from './testing_utils.js';

describe('request builders', () => {
  it('createStreamMessageRequest carries text part and coderAgent metadata', () => {
    const request = createStreamMessageRequest('hello', 'm1');
    expect(request.method).toBe('message/stream');
    expect(request.params.message.parts[0]).toStrictEqual({
      kind: 'text',
      text: 'hello',
    });
    expect(request.params.message.metadata.coderAgent.kind).toBe(
      'agent-settings',
    );
    expect(request.params.message.metadata.coderAgent.workspacePath).toBe(
      '/tmp',
    );
    expect(request.params.taskId).toBeUndefined();
  });

  it('createStreamMessageRequest attaches taskId when given', () => {
    const request = createStreamMessageRequest('hello', 'm1', 'task-7');
    expect(request.params.taskId).toBe('task-7');
  });

  it('createConfirmationMessageRequest carries callId/outcome data part', () => {
    const request = createConfirmationMessageRequest(
      'call-1',
      'proceed_once',
      'm2',
      'task-7',
    );
    expect(request.params.message.parts[0]).toStrictEqual({
      kind: 'data',
      data: { callId: 'call-1', outcome: 'proceed_once' },
    });
    expect(request.params.taskId).toBe('task-7');
  });
});
