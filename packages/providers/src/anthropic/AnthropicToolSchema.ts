/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';

export function findAnthropicToolSchema(
  tools: ToolDeclaration[] | undefined,
  toolName: string,
  isOAuth: boolean,
  unprefixToolName: (name: string, isOAuth: boolean) => string,
): unknown {
  if (tools === undefined) return undefined;
  for (const declaration of tools) {
    const declarationName = isOAuth
      ? unprefixToolName(declaration.name, true)
      : declaration.name;
    if (declarationName === toolName) {
      return declaration.parametersJsonSchema;
    }
  }
  return undefined;
}
