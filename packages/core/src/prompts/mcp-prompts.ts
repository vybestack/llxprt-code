/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { type DiscoveredMCPPrompt } from '../tools/mcp-client.js';

export function getMCPServerPrompts(
  config: Config,
  serverName: string,
): DiscoveredMCPPrompt[] {
  return config.getPromptRegistry().getPromptsByServer(serverName);
}
