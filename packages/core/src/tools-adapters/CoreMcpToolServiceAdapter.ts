/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IMcpToolService,
  McpFunctionCall,
  McpResponsePart,
} from '@vybestack/llxprt-code-tools';
import type { CallableTool, FunctionCall } from '@google/genai';

export class CoreMcpToolServiceAdapter implements IMcpToolService {
  constructor(
    private readonly callableTool: CallableTool,
    private readonly trustedFolderProvider?: () => boolean,
  ) {}

  isTrustedFolder(): boolean {
    return this.trustedFolderProvider?.() ?? false;
  }

  async callTool(functionCalls: McpFunctionCall[]): Promise<McpResponsePart[]> {
    const sdkFunctionCalls = functionCalls.map(
      (functionCall): FunctionCall => ({
        name: functionCall.name,
        args: functionCall.args,
      }),
    );
    const response = await this.callableTool.callTool(sdkFunctionCalls);
    return response as McpResponsePart[];
  }
}
