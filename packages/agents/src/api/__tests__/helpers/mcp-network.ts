/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spyOn } from 'bun:test';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';

export function installMcpNetwork(requestFetch: NetworkFetch): () => void {
  const create = McpRuntimeOwner.create;
  const injection = spyOn(McpRuntimeOwner, 'create').mockImplementation(
    (acquisition, operations) =>
      create({ ...acquisition, requestFetch }, operations),
  );
  return () => injection.mockRestore();
}
