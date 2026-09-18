/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Google MCP auth runtime plugin (issue #2759 reserved stub).
 *
 * This context is reserved so the Google MCP auth work lands in a prepared
 * package topology instead of being invented later. It intentionally stays a
 * minimal stub for the whole of #2759: the manifest v1 schema requires at
 * least one provider contribution, so the stub contributes a placeholder that
 * fails actionably rather than pretending to provide something.
 */
import type {
  ProviderAliasFactory,
  RuntimePluginManifest,
} from '@vybestack/llxprt-code-providers/composition.js';

const createReservedMcpAuthProvider: ProviderAliasFactory = () => {
  throw new Error(
    'The @vybestack/llxprt-plugin-google-mcp-auth plugin is a reserved stub; it does not contribute a usable provider yet.',
  );
};

export const llxprtRuntimePlugin = {
  apiVersion: 1,
  id: '@vybestack/llxprt-plugin-google-mcp-auth',
  providers: [
    {
      providerId: 'google-mcp-auth',
      createProvider: createReservedMcpAuthProvider,
    },
  ],
} satisfies RuntimePluginManifest;
