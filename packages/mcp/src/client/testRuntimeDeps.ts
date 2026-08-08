/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test helper: wraps a flat Config-style mock (the pattern mcp-client-manager
 * tests used before P06) into the nested RuntimeDependencies shape that
 * McpClientManager now expects. Methods that return services (promptRegistry,
 * resourceRegistry) are invoked to extract the value; all others are delegated
 * unchanged into the nested role/service structure.
 */
export function wrapFlatConfigAsRuntimeDeps(
  flat: Record<string, unknown>,
): Record<string, unknown> {
  return {
    policy: {
      isTrustedFolder: (flat.isTrustedFolder ?? (() => true)) as () => boolean,
    },
    mcp: {
      refreshMcpContext: (flat.refreshMcpContext ??
        (async () => {})) as () => Promise<void>,
      getMcpServers: (flat.getMcpServers ?? (() => undefined)) as () => unknown,
      getMcpServerCommand: (flat.getMcpServerCommand ??
        (() => undefined)) as () => unknown,
      getAllowedMcpServers: (flat.getAllowedMcpServers ??
        (() => undefined)) as () => unknown,
      getBlockedMcpServers: (flat.getBlockedMcpServers ??
        (() => undefined)) as () => unknown,
    },
    paths: {
      getWorkspaceContext: (flat.getWorkspaceContext ??
        (() => ({}))) as () => unknown,
    },
    diagnostics: {
      getDebugMode: (flat.getDebugMode ?? (() => false)) as () => boolean,
    },
    promptRegistry:
      typeof flat.getPromptRegistry === 'function'
        ? (flat.getPromptRegistry as () => unknown)()
        : {},
    resourceRegistry:
      typeof flat.getResourceRegistry === 'function'
        ? (flat.getResourceRegistry as () => unknown)()
        : {},
    extensionLoader: {
      getExtensions: (flat.getExtensions ?? (() => [])) as () => unknown[],
    },
  };
}
