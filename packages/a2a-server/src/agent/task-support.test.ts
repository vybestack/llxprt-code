/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  mapOutcomeStringToEnum,
  buildToolConfirmationPayload,
  convertAnsiOutputToString,
  createTextMessage,
  createDataMessage,
} from './task-support.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-core';

describe('mapOutcomeStringToEnum', () => {
  it('maps each supported outcome string to its enum value', () => {
    expect(mapOutcomeStringToEnum('proceed_once')).toBe(
      ToolConfirmationOutcome.ProceedOnce,
    );
    expect(mapOutcomeStringToEnum('cancel')).toBe(
      ToolConfirmationOutcome.Cancel,
    );
    expect(mapOutcomeStringToEnum('proceed_always')).toBe(
      ToolConfirmationOutcome.ProceedAlways,
    );
    expect(mapOutcomeStringToEnum('proceed_always_server')).toBe(
      ToolConfirmationOutcome.ProceedAlwaysServer,
    );
    expect(mapOutcomeStringToEnum('proceed_always_tool')).toBe(
      ToolConfirmationOutcome.ProceedAlwaysTool,
    );
    expect(mapOutcomeStringToEnum('modify_with_editor')).toBe(
      ToolConfirmationOutcome.ModifyWithEditor,
    );
    expect(mapOutcomeStringToEnum('suggest_edit')).toBe(
      ToolConfirmationOutcome.SuggestEdit,
    );
  });

  it('returns undefined for an unknown outcome', () => {
    expect(mapOutcomeStringToEnum('not-an-outcome')).toBeUndefined();
  });
});

describe('buildToolConfirmationPayload', () => {
  it('returns undefined when neither newContent nor editedCommand is present', () => {
    expect(buildToolConfirmationPayload({})).toBeUndefined();
  });

  it('carries newContent and editedCommand strings', () => {
    expect(
      buildToolConfirmationPayload({
        newContent: 'new',
        editedCommand: 'cmd',
      }),
    ).toStrictEqual({ newContent: 'new', editedCommand: 'cmd' });
  });

  it('filters non-string payload fields', () => {
    expect(
      buildToolConfirmationPayload({
        newContent: 7,
        editedCommand: 8,
      }),
    ).toBeUndefined();
  });
});

describe('convertAnsiOutputToString', () => {
  it('passes plain strings through unchanged', () => {
    expect(convertAnsiOutputToString('plain')).toBe('plain');
  });

  it('flattens an ANSI token grid into newline-joined text', () => {
    const token = (text: string) =>
      ({
        text,
        bold: false,
        italic: false,
        underline: false,
        dim: false,
        inverse: false,
        fg: '',
        bg: '',
      }) as never;
    const grid = [[token('a'), token('b')], [token('c')]];
    expect(convertAnsiOutputToString(grid)).toBe('ab\nc');
  });
});

describe('createTextMessage / createDataMessage', () => {
  it('builds an agent text message carrying taskId and contextId', () => {
    const message = createTextMessage('hello', 'task-1', 'ctx-1');
    expect(message.kind).toBe('message');
    expect(message.role).toBe('agent');
    expect(message.taskId).toBe('task-1');
    expect(message.contextId).toBe('ctx-1');
    expect(message.parts).toStrictEqual([{ kind: 'text', text: 'hello' }]);
  });

  it('builds a data message wrapping the raw payload', () => {
    const message = createDataMessage({ value: 1 }, 'task-1', 'ctx-1');
    expect(message.kind).toBe('message');
    expect(message.role).toBe('agent');
    expect(message.taskId).toBe('task-1');
    expect(message.contextId).toBe('ctx-1');
    expect(message.parts).toStrictEqual([{ kind: 'data', data: { value: 1 } }]);
  });
});
