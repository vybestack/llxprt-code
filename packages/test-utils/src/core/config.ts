/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import { emptyModelOutput } from '@vybestack/llxprt-code-core/llm-types/modelEnvelope.js';
import { WorkspaceMcpCatalogOwner } from '@vybestack/llxprt-code-core';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ServerAgentStreamEvent } from '@vybestack/llxprt-code-core/core/turn.js';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import { SimpleExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core/config/config.js';
import { createTestAgentChat } from './fixture-agent-chat.js';
export {
  installTestWorkspaceFilesystem,
  installTestWorkspacePaths,
} from './workspace-filesystem.js';
export { createTestOAuthBinding } from './fixture-mcp-auth.js';
export { makeFakeConfig } from './fixture-fake-config.js';

async function* fromAsyncArray<T>(items: T[]): AsyncGenerator<T, void> {
  for (const item of items) {
    yield item;
  }
}

function emptyServerAgentStream(): AsyncGenerator<
  ServerAgentStreamEvent,
  unknown
> {
  return fromAsyncArray<ServerAgentStreamEvent>([]);
}

export function createTestAgentClient(
  overrides?: Partial<AgentClientContract>,
  identity?: {
    readonly config: Config;
    readonly manager: RuntimeProviderManager;
  },
): AgentClientContract {
  const chat = createTestAgentChat();
  let selection: ToolSelection = {
    getTool: () => undefined,
    getAllToolNames: () => [],
    getAllTools: () => [],
    getEnabledTools: () => [],
    getFunctionDeclarations: () => [],
    getFunctionDeclarationsFiltered: () => [],
  };
  return {
    get tools() {
      return selection;
    },
    bindProviderInvocation: () => {},
    bindRuntimeSettings: () => {},
    bindTelemetry: () => {},
    bindModelNotifications: () => {},
    bindIdeContext: () => {},
    bindWorkspaceDefinitions: () => {},
    bindProviderFiles: () => {},
    bindTokenization: () => {},
    bindProviderSelection: () => {},
    bindToolSelection: (tools) => {
      selection = tools;
    },
    assertConfig: (config) => {
      if (identity?.config !== config)
        throw new Error('Test client Config identity mismatch');
    },
    assertProviderManager: (manager) => {
      if (identity?.manager !== manager)
        throw new Error('Test client manager identity mismatch');
    },
    initialize: async () => {},
    isInitialized: () => true,
    hasChatInitialized: () => true,
    getChat: () => chat,
    getHistory: async () => [],
    getHistoryService: () => null,
    storeHistoryServiceForReuse: () => {},
    prepareHistoryRebind: () => () => {},
    storeHistoryForLaterUse: async () => {},
    dispose: async () => {},
    setTools: async () => {},
    clearTools: () => {},
    updateSystemInstruction: async () => {},
    addHistory: async () => {},
    resetChat: async () => {},
    resumeChat: async () => {},
    setHistory: async () => {},
    restoreHistory: async () => {},
    addDirectoryContext: async () => {},
    getContentGenerator: () => undefined as never,
    getContentGeneratorConfig: () => undefined,
    startChat: async () => chat,
    generateDirectMessage: async () => emptyModelOutput(),
    generateJson: async () => ({}),
    generateContent: async () => emptyModelOutput(),
    generateEmbedding: async (texts: string[]) => texts.map(() => []),
    sendMessageStream: () => emptyServerAgentStream(),
    getCurrentSequenceModel: () => null,
    ...overrides,
  };
}

export function createTestExtensionLoader(
  extensions: LlxprtExtension[],
): SimpleExtensionLoader {
  return new SimpleExtensionLoader(extensions);
}

export function installTestCatalogOwners(): () => WorkspaceMcpCatalogOwner {
  let roots: readonly WorkspaceMcpCatalogOwner[] = [];
  afterEach(async () => {
    const retained = roots;
    roots = [];
    const failures: unknown[] = [];
    for (const root of [...retained].reverse()) {
      try {
        await root.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Test catalog cleanup failed');
  });
  return (): WorkspaceMcpCatalogOwner => {
    const root = new WorkspaceMcpCatalogOwner(
      () => true,
      async () => {
        throw new Error('Manager fixture has no resource transport');
      },
    );
    roots = [...roots, root];
    return root;
  };
}
