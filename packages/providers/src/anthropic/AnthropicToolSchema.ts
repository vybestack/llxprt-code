/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

interface ToolDeclarationGroup {
  functionDeclarations: Array<{
    name: string;
    parametersJsonSchema?: unknown;
  }>;
}

export function findAnthropicToolSchema(
  tools: ToolDeclarationGroup[] | undefined,
  toolName: string,
  isOAuth: boolean,
  unprefixToolName: (name: string, isOAuth: boolean) => string,
): unknown {
  if (tools === undefined) return undefined;
  for (const group of tools) {
    for (const declaration of group.functionDeclarations) {
      const declarationName = isOAuth
        ? unprefixToolName(declaration.name, true)
        : declaration.name;
      if (declarationName === toolName) {
        return declaration.parametersJsonSchema;
      }
    }
  }
  return undefined;
}
