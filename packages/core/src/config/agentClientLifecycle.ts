/**
 * Agent client lifecycle helpers extracted from Config to keep config.ts
 * under size/complexity limits.
 *
 * These functions handle the extract → rebuild → transfer → initialize
 * cycle that occurs when the content generator config is refreshed
 * (e.g. on model switch, auth refresh, provider change).
 */

import type { DebugLogger } from '../debug/DebugLogger.js';
import { createContentGeneratorConfig } from '../core/contentGenerator.js';
import type {
  AgentClientContract,
  AgentClientFactory,
} from '../core/clientContract.js';
import type { IContent } from '../services/history/IContent.js';
import { createAgentRuntimeStateFromConfig } from '../runtime/runtimeStateFactory.js';
import type { Config } from './config.js';

/**
 * Removes `signature` from every thinking block in the history.
 * Used when migrating from GenAI to Vertex (Vertex does not support
 * thought signatures).
 *
 * History IContent[] is external data that was serialized/deserialized,
 * so blocks are validated at this boundary.
 */
export function stripThoughtSignatures(history: IContent[]): IContent[] {
  return history.map((content) => ({
    ...content,
    blocks: content.blocks.map((block) => {
      if (isBlockWithSignature(block)) {
        const newBlock = { ...block };
        delete (newBlock as { signature?: unknown }).signature;
        return newBlock;
      }
      return block;
    }),
  }));
}

/**
 * Type guard validating that an untyped history block is a non-null object
 * containing a `signature` key. History data may not match the static
 * ThinkingBlock type at runtime.
 */
function isBlockWithSignature(block: unknown): block is Record<
  string,
  unknown
> & {
  signature?: unknown;
} {
  return (
    block !== null &&
    typeof block === 'object' &&
    'signature' in (block as Record<string, unknown>)
  );
}

/**
 * Context required by the agent client lifecycle functions.
 * Provides access to the Config fields and methods needed without
 * coupling the helpers to the full Config surface.
 */
export interface AgentClientLifecycleContext {
  readonly agentClient: AgentClientContract;
  readonly contentGeneratorConfig: ReturnType<
    typeof createContentGeneratorConfig
  >;
  readonly providerManager: Config['providerManager'];
  readonly contentGeneratorFactory: Config['contentGeneratorFactory'];
  readonly runtimeState: Config['runtimeState'];
}

/**
 * Extracts existing history and HistoryService from the current agent client.
 *
 * Returns empty values only when no client exists or the client carries no
 * recoverable state. A client pending lazy initialization (no chat yet) may
 * still hold restored conversation in `_previousHistory` / a stored
 * HistoryService, which `getHistory()` / `getHistoryService()` surface — that
 * state must survive a rebuild so --continue keeps model context (issue #2500).
 *
 * The agentClient parameter is accepted as `| undefined` because the Config
 * field is declared with a definite-assignment assertion but is genuinely
 * undefined before Config.initialize() runs.
 */
export async function extractExistingState(
  logger: DebugLogger,
  agentClient: AgentClientContract | null | undefined,
): Promise<{
  history: IContent[];
  historyService: ReturnType<AgentClientContract['getHistoryService']>;
}> {
  if (agentClient === null || agentClient === undefined) {
    return { history: [], historyService: null };
  }

  // A client may carry restored conversation in `_previousHistory` (e.g. a
  // prior --continue restoreHistory, or a previous rebuild's carried history)
  // even before its chat/content generator are lazily initialized. The old
  // `!isInitialized()` guard discarded that history on the next rebuild, so
  // --continue lost model context (issue #2500). `getHistory()` /
  // `getHistoryService()` already recover `_previousHistory` /
  // `_storedHistoryService` when no chat exists, so fall through and let them
  // surface whatever state the client holds.
  const hasInitializedChat = hasCallableProperty(
    agentClient,
    'hasChatInitialized',
  )
    ? agentClient.hasChatInitialized()
    : false;
  const existingHistory = hasInitializedChat
    ? agentClient.getChat().getHistory()
    : await agentClient.getHistory();
  const existingHistoryService = hasInitializedChat
    ? null
    : agentClient.getHistoryService();
  logger.debug('Retrieved existing state', {
    historyLength: existingHistory.length,
    hasHistoryService: !!existingHistoryService,
  });
  return {
    history: existingHistory,
    historyService: existingHistoryService,
  };
}

function hasCallableProperty<TObject extends object, TKey extends PropertyKey>(
  value: TObject,
  property: TKey,
): value is TObject & Record<TKey, (...args: never[]) => unknown> {
  return (
    property in value &&
    typeof (value as Record<PropertyKey, unknown>)[property] === 'function'
  );
}

/**
 * Builds a fresh ContentGeneratorConfig and computes the new runtime state
 * to match the new model/proxy settings.
 *
 * Returns both the new config and the new runtime state; the caller is
 * responsible for assigning the runtime state (it is protected).
 */
export function buildNewContentGeneratorConfig(
  config: Config,
  providerManager: Config['providerManager'],
  contentGeneratorFactory: Config['contentGeneratorFactory'],
  runtimeState: Config['runtimeState'],
): {
  contentGeneratorConfig: ReturnType<typeof createContentGeneratorConfig>;
  runtimeState: Config['runtimeState'];
} {
  const newContentGeneratorConfig = createContentGeneratorConfig(config);
  if (providerManager) {
    newContentGeneratorConfig.providerManager = providerManager;
  }
  if (contentGeneratorFactory) {
    newContentGeneratorConfig.contentGeneratorFactory = contentGeneratorFactory;
  }
  const updatedRuntimeState = createAgentRuntimeStateFromConfig(config, {
    runtimeId: runtimeState.runtimeId,
    overrides: {
      model: newContentGeneratorConfig.model,
      proxyUrl: newContentGeneratorConfig.proxy ?? runtimeState.proxyUrl,
    },
  });
  return {
    contentGeneratorConfig: newContentGeneratorConfig,
    runtimeState: updatedRuntimeState,
  };
}

/**
 * Transfers existing history to the new agent client, stripping thought
 * signatures when migrating from GenAI to Vertex.
 */
export function transferHistoryToNewClient(
  logger: DebugLogger,
  newAgentClient: AgentClientContract,
  existingHistory: IContent[],
  existingHistoryService: ReturnType<AgentClientContract['getHistoryService']>,
  newContentGeneratorConfig: ReturnType<typeof createContentGeneratorConfig>,
  previousVertexai: boolean | undefined,
): void {
  const fromGenaiToVertex =
    previousVertexai === false && newContentGeneratorConfig.vertexai === true;
  if (existingHistoryService) {
    logger.debug('Skipping existing HistoryService reuse', {
      historyLength: existingHistory.length,
      fromGenaiToVertex,
    });
  }
  if (existingHistory.length === 0) {
    return;
  }
  logger.debug('Storing history for later use', {
    historyLength: existingHistory.length,
    fromGenaiToVertex,
    willStripThoughts: fromGenaiToVertex,
  });
  const historyToStore = fromGenaiToVertex
    ? stripThoughtSignatures(existingHistory)
    : existingHistory;
  newAgentClient.storeHistoryForLaterUse(historyToStore);
  logger.debug('History stored in new client', {
    storedHistoryLength: historyToStore.length,
  });
}

/**
 * Disposes the previous agent client if it exists and has a dispose method.
 */
export function disposePreviousAgentClient(
  logger: DebugLogger,
  previousAgentClient: AgentClientContract | undefined,
): void {
  if (previousAgentClient !== undefined) {
    try {
      previousAgentClient.dispose();
    } catch (error) {
      logger.warn(
        () =>
          `Failed to dispose previous AgentClient: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }
}

/**
 * Requires that an agent client factory is available, throwing a descriptive
 * error if it was not injected.
 */
export function requireAgentClientFactory(
  factory: AgentClientFactory | undefined,
  operation: string,
): AgentClientFactory {
  if (!factory) {
    throw new Error(
      `agentClientFactory is required before Config.${operation}() can create an AgentClient`,
    );
  }
  return factory;
}

function createDetachedRuntimeId(baseRuntimeId: string | undefined): string {
  const timestamp = Date.now().toString(36);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${baseRuntimeId ?? 'llxprt-session'}#subagent-auto#${timestamp}-${suffix}`;
}

/**
 * Creates a detached agent client with a fresh runtime state isolated from
 * the session's primary agent client. The returned client has its tool set
 * cleared. Used for one-shot operations such as subagent auto-prompt
 * generation that need a clean, isolated runtime scope.
 */
export function createDetachedAgentClient(
  config: Config,
  runtimeId?: string,
): AgentClientContract {
  const factory = requireAgentClientFactory(
    config.getAgentClientFactory(),
    'createDetachedAgentClient',
  );
  const baseRuntimeId = config.getSessionId();
  const detachedId = runtimeId ?? createDetachedRuntimeId(baseRuntimeId);
  const detachedRuntimeState = createAgentRuntimeStateFromConfig(config, {
    runtimeId: detachedId,
  });
  const client = factory(config, detachedRuntimeState);
  try {
    client.clearTools();
  } catch (error) {
    try {
      client.dispose();
    } catch {
      // Disposal failure is secondary; preserve the clearTools error.
    }
    throw error;
  }
  return client;
}
