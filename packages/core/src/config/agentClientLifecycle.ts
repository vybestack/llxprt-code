/**
 * Agent client lifecycle helpers extracted from Config to keep config.ts
 * under size/complexity limits.
 *
 * These functions handle the extract → rebuild → transfer → initialize
 * cycle that occurs when the content generator config is refreshed
 * (e.g. on model switch, auth refresh, provider change).
 */

import type { Content } from '@google/genai';
import type { DebugLogger } from '../debug/DebugLogger.js';
import { createContentGeneratorConfig } from '../core/contentGenerator.js';
import type {
  AgentClientContract,
  AgentClientFactory,
} from '../core/clientContract.js';
import { createAgentRuntimeStateFromConfig } from '../runtime/runtimeStateFactory.js';
import type { Config } from './config.js';

/**
 * Removes `thoughtSignature` from every part in the history.
 * Used when migrating from GenAI to Vertex (Vertex does not support
 * thought signatures).
 *
 * History Content[] is external data from the Gemini API that was
 * serialized/deserialized, so parts are validated at this boundary.
 */
export function stripThoughtSignatures(history: Content[]): Content[] {
  return history.map((content) => {
    if (!content.parts) {
      return content;
    }
    return {
      ...content,
      parts: content.parts.map((part) => {
        if (isPartWithThoughtSignature(part)) {
          const newPart = { ...part };
          delete (newPart as { thoughtSignature?: unknown }).thoughtSignature;
          return newPart;
        }
        return part;
      }),
    };
  });
}

/**
 * Type guard validating that an untyped history part is a non-null object
 * containing a `thoughtSignature` key. History data originates from the
 * Gemini API and may not match the static Part type at runtime.
 */
function isPartWithThoughtSignature(part: unknown): part is Record<
  string,
  unknown
> & {
  thoughtSignature?: unknown;
} {
  return (
    part !== null &&
    typeof part === 'object' &&
    'thoughtSignature' in (part as Record<string, unknown>)
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
 * Returns empty values when the client is not yet initialized.
 *
 * The agentClient parameter is accepted as `| undefined` because the Config
 * field is declared with a definite-assignment assertion but is genuinely
 * undefined before Config.initialize() runs.
 */
export async function extractExistingState(
  logger: DebugLogger,
  agentClient: AgentClientContract | null | undefined,
): Promise<{
  history: Content[];
  historyService: ReturnType<AgentClientContract['getHistoryService']>;
}> {
  if (agentClient === null || agentClient === undefined) {
    return { history: [], historyService: null };
  }
  if (!agentClient.isInitialized()) {
    return { history: [], historyService: null };
  }

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
  existingHistory: Content[],
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
