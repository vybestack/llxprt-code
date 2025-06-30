/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ITool } from '../providers/ITool.js';
import { IMessage } from '../providers/IMessage.js';

export type ToolFormat = 'openai' | 'hermes' | 'xml'; // Extend as needed

export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters: object;
}

export interface OpenAITool {
  type: 'function';
  function: OpenAIFunction;
}

export interface IToolFormatter {
  toProviderFormat(tools: ITool[], format: 'openai'): OpenAITool[];
  toProviderFormat(tools: ITool[], format: ToolFormat): unknown;
  fromProviderFormat(
    rawToolCall: unknown,
    format: ToolFormat,
  ): IMessage['tool_calls'];
}
