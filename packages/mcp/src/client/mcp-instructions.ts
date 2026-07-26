/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpClient } from './mcp-client.js';

export function collectMcpInstructions(
  clients: ReadonlyMap<string, McpClient>,
): string {
  const instructions: string[] = [];
  for (const [name, client] of clients) {
    const clientInstructions = client.getInstructions();
    if (clientInstructions) {
      instructions.push(
        `The following are instructions provided by the tool server '${name}':\n---[start of server instructions]---\n${clientInstructions}\n---[end of server instructions]---`,
      );
    }
  }
  return instructions.join('\n\n');
}
