/**
 * Agent client lifecycle helpers extracted from Config to keep config.ts
 * under size/complexity limits.
 *
 * These functions handle the extract → rebuild → transfer → initialize
 * cycle that occurs when the content generator config is refreshed
 * (e.g. on model switch, auth refresh, provider change).
 */

import type { RuntimeContentGeneratorFactory } from '../runtime/contracts/RuntimeContentGeneratorFactory.js';
import type { ContentGenerator } from '../core/contentGenerator.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import { createContentGeneratorConfig } from '../core/contentGenerator.js';
import type {
  AgentClientContract,
  AgentClientFactory,
} from '../core/clientContract.js';
import type { IContent } from '../services/history/IContent.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type { Config } from './config.js';

/**
 * Removes `signature` from every thinking block in the history.
 * Used when migrating from GenAI to Vertex (Vertex does not support
 * thought signatures).
 *
 * History IContent[] is external data that was serialized/deserialized,
 * so blocks are validated at this boundary.
 */
export function stripThoughtSignatures(
  history: readonly IContent[],
): IContent[] {
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
  readonly contentGeneratorConfig: ReturnType<
    typeof createContentGeneratorConfig
  >;
  readonly contentGeneratorFactory:
    | RuntimeContentGeneratorFactory<ContentGenerator>
    | undefined;
  readonly runtimeState: AgentRuntimeState;
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
  history: readonly IContent[];
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
  contentGeneratorFactory:
    | RuntimeContentGeneratorFactory<ContentGenerator>
    | undefined,
  runtimeState: AgentRuntimeState,
): {
  contentGeneratorConfig: ReturnType<typeof createContentGeneratorConfig>;
  runtimeState: AgentRuntimeState;
} {
  const newContentGeneratorConfig = createContentGeneratorConfig({
    model: runtimeState.model,
    proxy: runtimeState.proxyUrl,
  });
  if (contentGeneratorFactory) {
    newContentGeneratorConfig.contentGeneratorFactory = contentGeneratorFactory;
  }
  return {
    contentGeneratorConfig: newContentGeneratorConfig,
    runtimeState,
  };
}

/**
 * Transfers existing history to the new agent client, stripping thought
 * signatures when migrating from GenAI to Vertex.
 */
export async function transferHistoryToNewClient(
  logger: DebugLogger,
  newAgentClient: AgentClientContract,
  existingHistory: readonly IContent[],
  existingHistoryService: ReturnType<AgentClientContract['getHistoryService']>,
  newContentGeneratorConfig: ReturnType<typeof createContentGeneratorConfig>,
  previousVertexai: boolean | undefined,
): Promise<void> {
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
  await newAgentClient.storeHistoryForLaterUse(historyToStore);
  logger.debug('History stored in new client', {
    storedHistoryLength: historyToStore.length,
  });
}

export async function prepareProfileClient(
  config: Config,
  previousClient: AgentClientContract,
  factory: AgentClientFactory,
  selectedState: AgentRuntimeState,
  contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
): Promise<
  ReturnType<typeof buildNewContentGeneratorConfig> & {
    client: AgentClientContract;
    prepareHistoryCommit: () => Promise<() => void>;
    retire: () => Promise<void>;
    discard: () => Promise<void>;
  }
> {
  const history = structuredClone(await previousClient.getHistory());
  const prepared = buildNewContentGeneratorConfig(
    contentGeneratorFactory,
    selectedState,
  );
  const client = factory(
    config,
    prepared.runtimeState,
    undefined,
    previousClient.mediaStore,
  );
  await prepareAgentClientReplacement(
    new DebugLogger('llxprt:config:prepareProfileClientReplacement'),
    client,
    undefined,
    history,
    null,
    prepared.contentGeneratorConfig,
    previousClient.getContentGeneratorConfig()?.vertexai,
  );
  return {
    ...prepared,
    client,
    prepareHistoryCommit: async () => {
      const live = previousClient.getHistoryService();
      const candidate = client.getHistoryService();
      if (live === null) return () => {};
      if (candidate === null)
        throw new Error('Prepared profile chat has no history');
      const adopt = await live.prepareProfileAdoption(candidate);
      const detachPrevious = previousClient.prepareHistoryRebind(candidate);
      const attachCandidate = client.prepareHistoryRebind(
        live,
        previousClient.hasChatInitialized()
          ? previousClient.getChat()
          : undefined,
      );
      return () => {
        detachPrevious();
        adopt();
        attachCandidate();
      };
    },
    retire: () => previousClient.dispose(),
    discard: () => client.dispose(),
  };
}

export async function prepareAgentClientReplacement(
  logger: DebugLogger,
  newAgentClient: AgentClientContract,
  previousAgentClient: AgentClientContract | null | undefined,
  existingHistory: readonly IContent[],
  existingHistoryService: ReturnType<AgentClientContract['getHistoryService']>,
  newContentGeneratorConfig: ReturnType<typeof createContentGeneratorConfig>,
  previousVertexai: boolean | undefined,
): Promise<void> {
  try {
    await transferHistoryToNewClient(
      logger,
      newAgentClient,
      existingHistory,
      existingHistoryService,
      newContentGeneratorConfig,
      previousVertexai,
    );
    await newAgentClient.initialize(newContentGeneratorConfig);
    await disposePreviousAgentClient(logger, previousAgentClient);
  } catch (error: unknown) {
    try {
      await disposePreviousAgentClient(logger, newAgentClient);
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [error, cleanupError],
        'Agent client replacement failed and new client cleanup was incomplete',
      );
    }
    throw error;
  }
}

/**
 * Disposes the previous agent client if it exists and has a dispose method.
 */
export async function disposePreviousAgentClient(
  _logger: DebugLogger,
  previousAgentClient: AgentClientContract | null | undefined,
): Promise<void> {
  if (
    previousAgentClient !== null &&
    previousAgentClient !== undefined &&
    hasCallableProperty(previousAgentClient, 'dispose')
  ) {
    await previousAgentClient.dispose();
  }
}
