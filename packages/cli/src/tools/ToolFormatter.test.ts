/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolFormatter } from './ToolFormatter';
import { ITool } from '../providers/ITool';

describe('ToolFormatter', () => {
  let formatter: ToolFormatter;

  beforeEach(() => {
    formatter = new ToolFormatter();
  });

  it('should throw NotYetImplemented for toProviderFormat', () => {
    const tools: ITool[] = [];
    expect(() => formatter.toProviderFormat(tools, 'openai')).toThrow(
      'NotYetImplemented',
    );
  });

  it('should throw NotYetImplemented for fromProviderFormat', () => {
    const rawToolCall = {};
    expect(() => formatter.fromProviderFormat(rawToolCall, 'openai')).toThrow(
      'NotYetImplemented',
    );
  });
});
