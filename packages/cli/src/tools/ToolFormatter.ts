/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IToolFormatter, ToolFormat } from './IToolFormatter.js';
import { ITool } from '../providers/ITool.js';
import { IMessage } from '../providers/IMessage.js';

export class ToolFormatter implements IToolFormatter {
  toProviderFormat(tools: ITool[], format: ToolFormat): any {
    throw new Error('NotYetImplemented');
  }

  fromProviderFormat(
    rawToolCall: any,
    format: ToolFormat,
  ): IMessage['tool_calls'] {
    throw new Error('NotYetImplemented');
  }
}
