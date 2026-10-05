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
  DeferredHistorySourceOptions,
} from '../core/clientContract.js';
import type { IContent } from '../services/history/IContent.js';
import { createAgentRuntimeStateFromConfig } from '../runtime/runtimeStateFactory.js';
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
  readonly agentClient: AgentClientContract;
  readonly contentGeneratorConfig: ReturnType<
    typeof createContentGeneratorConfig
  >;
  readonly providerManager: Config['providerManager'];
  readonly contentGeneratorFactory: Config['contentGeneratorFactory'];
  readonly runtimeState: Config['runtimeState'];
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
export async function createDetachedAgentClient(
  config: Config,
  runtimeId?: string,
): Promise<AgentClientContract> {
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
      await client.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Detached agent client setup and cleanup failed',
      );
    }
    throw error;
  }
  return client;
}
