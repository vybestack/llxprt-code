/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ITool } from '../providers/ITool.js';
import { IMessage } from '../providers/IMessage.js';

export type ToolFormat = 'openai' | 'hermes' | 'xml'; // Extend as needed

export interface IToolFormatter {
  toProviderFormat(tools: ITool[], format: ToolFormat): any;
  fromProviderFormat(
    rawToolCall: any,
    format: ToolFormat,
  ): IMessage['tool_calls'];
}
