/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ITool } from '../providers/ITool.js';
import { IMessage } from '../providers/IMessage.js';

export type ToolFormat =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'qwen'
  | 'hermes'
  | 'xml'
  | 'llama'
  | 'gemma';

export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters: object;
}

export interface OpenAITool {
  type: 'function';
  function: OpenAIFunction;
}

export interface ResponsesTool {
  type: 'function';
  name: string;
  description?: string | null;
  parameters: Record<string, unknown> | null;
  strict: boolean | null;
}

export interface IToolFormatter {
  toProviderFormat(tools: ITool[], format: 'openai'): OpenAITool[];
  toProviderFormat(tools: ITool[], format: ToolFormat): unknown;
  fromProviderFormat(
    rawToolCall: unknown,
    format: ToolFormat,
  ): IMessage['tool_calls'];
  toResponsesTool(tools: ITool[]): ResponsesTool[];
}
