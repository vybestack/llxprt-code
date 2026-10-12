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
  DeferredHistorySourceOptions,
} from '../core/clientContract.js';
import type { IContent } from '../services/history/IContent.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type { Config } from './config.js';

/**
 * Removes signatures from one row when moving from GenAI to Vertex.
 * Serialized history is external data, so blocks are validated here.
 */
function stripContentThoughtSignatures(content: IContent): IContent {
  return {
    ...content,
    blocks: content.blocks.map((block) => {
      if (isBlockWithSignature(block)) {
        const newBlock = { ...block };
        delete newBlock.signature;
        return newBlock;
      }
      return block;
    }),
  };
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
 * Extracts a cold history source and service from the current agent client.
 * A client pending lazy initialization may carry deferred rows. Its public
 * stream covers that state as well as active chat, preserving --continue
 * history during rebuilds (issue #2500).
 *
 * The agentClient parameter is accepted as `| undefined` because the Config
 * field is declared with a definite-assignment assertion but is genuinely
 * undefined before Config.initialize() runs.
 */
export async function extractExistingState(
  logger: DebugLogger,
  agentClient: AgentClientContract | null | undefined,
  options: DeferredHistorySourceOptions = {},
): Promise<{
  history: AsyncIterable<IContent> | undefined;
  historyService: ReturnType<AgentClientContract['getHistoryService']>;
}> {
  if (agentClient === null || agentClient === undefined) {
    return { history: undefined, historyService: null };
  }

  // A client may carry restored conversation in `_previousHistory` (e.g. a
  // prior --continue restoreHistory, or a previous rebuild's carried history)
  // even before its chat/content generator are lazily initialized. The stream
  // defers capture until consumption and covers both active and deferred rows.
  const hasInitializedChat = hasCallableProperty(
    agentClient,
    'hasChatInitialized',
  )
    ? agentClient.hasChatInitialized()
    : false;
  const existingHistory = hasInitializedChat
    ? agentClient.getChat().streamHistory(options.signal)
    : agentClient.streamHistory(options.signal);
  const existingHistoryService = hasInitializedChat
    ? null
    : agentClient.getHistoryService();
  logger.debug('Retrieved existing history source', {
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
  existingHistory: AsyncIterable<IContent> | undefined,
  existingHistoryService: ReturnType<AgentClientContract['getHistoryService']>,
  newContentGeneratorConfig: ReturnType<typeof createContentGeneratorConfig>,
  previousVertexai: boolean | undefined,
  options: DeferredHistorySourceOptions = {},
): Promise<number> {
  options.signal?.throwIfAborted();
  if (existingHistory === undefined) return 0;
  const source = existingHistory;
  const fromGenaiToVertex =
    previousVertexai === false && newContentGeneratorConfig.vertexai === true;
  if (existingHistoryService) {
    logger.debug('Skipping existing HistoryService reuse', {
      fromGenaiToVertex,
    });
  }
  let transferred = 0;
  async function* historyToStore(): AsyncGenerator<IContent, void, unknown> {
    for await (const content of source) {
      options.signal?.throwIfAborted();
      options.ownership?.retain(content);
      try {
        yield fromGenaiToVertex
          ? stripContentThoughtSignatures(content)
          : content;
        transferred++;
      } finally {
        options.ownership?.release(content);
      }
    }
  }
  await newAgentClient.storeHistoryForLaterUse(historyToStore(), options);
  logger.debug('History stored in new client', {
    storedHistoryLength: transferred,
    fromGenaiToVertex,
  });
  return transferred;
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
  // A cold row stream: the replacement client's deferred admission pulls
  // rows from the live journal, so no context-sized copy exists here.
  const history = previousClient.streamHistory();
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
  existingHistory: AsyncIterable<IContent> | undefined,
  existingHistoryService: ReturnType<AgentClientContract['getHistoryService']>,
  newContentGeneratorConfig: ReturnType<typeof createContentGeneratorConfig>,
  previousVertexai: boolean | undefined,
  options: DeferredHistorySourceOptions = {},
): Promise<number> {
  try {
    const transferred = await transferHistoryToNewClient(
      logger,
      newAgentClient,
      existingHistory,
      existingHistoryService,
      newContentGeneratorConfig,
      previousVertexai,
      options,
    );
    await newAgentClient.initialize(newContentGeneratorConfig, options);
    await disposePreviousAgentClient(logger, previousAgentClient);
    return transferred;
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
