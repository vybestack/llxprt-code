/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CredentialResolutionError } from '@vybestack/llxprt-code-auth';
import {
  createRuntimeInvocationContext,
  readInvocationPolicyRecord,
  type RuntimeInvocationContext,
} from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { MissingProviderRuntimeError } from './errors.js';
import type {
  MaterializedGenerateChatOptions,
  ProviderToolset,
} from './IProvider.js';
import type {
  BaseProvider,
  NormalizedGenerateChatOptions,
} from './BaseProvider.js';
import type { ResolvedAuthToken } from './types/providerRuntime.js';
import { getRequestSignal, isAbortSignal } from './utils/abortSignal.js';
import {
  collectContents,
  isAsyncIterableContents,
} from './utils/collectContents.js';
import {
  acquireRequestRows,
  type RequestRowsScope,
} from './utils/requestRowsLease.js';
import { providerRowsOf } from './utils/providerRows.js';
import { copyProviderRequestOptions } from './requestAdmission.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from './IProvider.js';

interface RuntimeGuardInput {
  providerKey: string;
  metadata?: Record<string, unknown>;
  resolved?: NormalizedGenerateChatOptions['resolved'];
  stage: string;
}

interface RuntimeGuardResult {
  metadata: Record<string, unknown>;
}

interface ResolvedRuntimeShape {
  model?: unknown;
  baseURL?: unknown;
  authToken?: unknown;
}

interface ProviderSettings {
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
}

interface NormalizationDependencies {
  providerName: string;
  maybeTools?: ProviderToolset;
  authToken: ResolvedAuthToken;
  authFailure?: CredentialResolutionError;
  resolvedModel: string;
  resolvedBaseURL?: string;
  providerSettings: ProviderSettings;
  ephemeralsSnapshot: Readonly<Record<string, unknown>>;
  providerDefaults: Readonly<Record<string, unknown>>;
  configuredHeaders: Readonly<Record<string, string>>;
}

function findResolvedRuntimeGaps(
  resolved: NormalizedGenerateChatOptions['resolved'] | undefined,
): string[] {
  if (resolved === undefined) {
    return ['resolved'];
  }

  const missing: string[] = [];
  const r = resolved as ResolvedRuntimeShape;
  if (
    typeof r.model !== 'string' ||
    (typeof r.model === 'string' && r.model.trim() === '')
  ) {
    missing.push('resolved.model');
  }
  if (
    r.baseURL !== undefined &&
    r.baseURL !== null &&
    typeof r.baseURL !== 'string'
  ) {
    missing.push('resolved.baseURL');
  }
  if (r.authToken === undefined || r.authToken === null) {
    missing.push('resolved.authToken');
  }
  return missing;
}

function buildRuntimeMetadata(
  input: RuntimeGuardInput,
): Record<string, unknown> {
  return {
    ...(input.metadata ?? {}),
    requirement: 'REQ-SP4-001',
    stage: input.stage,
  };
}

/**
 * True when the call carries `requestRows`, which the provider's concrete
 * transport reads itself instead of receiving them through `contents`.
 */
export function readsRequestRowsAtTransport(
  options: Pick<GenerateChatOptions, 'requestRows'>,
): boolean {
  return options.requestRows !== undefined;
}

/**
 * Sanitized copy of the caller's options that also carries the neutral
 * request selection, which the shared admission copy does not know about.
 */
function copyRequestSelection(
  input: GenerateChatOptions,
): Omit<GenerateChatOptions, 'contents'> {
  const { contents: _contents, ...copied } = copyProviderRequestOptions(input);
  return {
    ...copied,
    ...(input.requestRows === undefined
      ? {}
      : { requestRows: input.requestRows }),
    ...(input.contentCount === undefined
      ? {}
      : { contentCount: input.contentCount }),
  };
}

/**
 * The single history source of a call. A neutral `requestRows` selection is
 * authoritative and read once through a reader bound to the request signal;
 * otherwise the caller's `contents` stream is the source.
 */
function historySourceOf(
  contentsOrOptions: AsyncIterable<IContent> | GenerateChatOptions,
): AsyncIterable<IContent> {
  if (isAsyncIterableContents(contentsOrOptions)) return contentsOrOptions;
  const rows = contentsOrOptions.requestRows;
  if (rows === undefined) return contentsOrOptions.contents;
  const signal = getRequestSignal(contentsOrOptions);
  signal?.throwIfAborted();
  return { [Symbol.asyncIterator]: () => rows.openReader(signal) };
}

/**
 * The prompt inputs a source-route send gives up because its prepared token
 * already carries them (issue #854 WP08).
 */
function blankedSourceInputs(
  options: Pick<GenerateChatOptions, 'promptEnvelopeTransportToken'>,
): Pick<
  GenerateChatOptions,
  'systemInstruction' | 'tools' | 'userMemory' | 'systemPromptAssembler'
> {
  return options.promptEnvelopeTransportToken === undefined
    ? {}
    : {
        systemInstruction: '',
        tools: [],
        userMemory: undefined,
        systemPromptAssembler: undefined,
      };
}

/**
 * Materialize the caller's history source for provider use (issue #854
 * P05b4). A call that carries `requestRows` and a provider that reads them at
 * its transport receive no collected history. A provider on the rows route
 * (`stagesRows`) receives its history later, from {@link attachDeferredHistory}.
 * Only a provider that keeps arrays by decision (the Vercel provider and the
 * Gemini plugin, GitHub #3869) is handed a collected array here.
 */
export async function materializeCallOptions(
  contentsOrOptions: AsyncIterable<IContent> | GenerateChatOptions,
  maybeTools: ProviderToolset | undefined,
  readsRowsAtTransport = false,
  stagesRows = false,
): Promise<MaterializedGenerateChatOptions> {
  if (readsRowsAtTransport && !isAsyncIterableContents(contentsOrOptions)) {
    return {
      ...copyRequestSelection(contentsOrOptions),
      contents: [],
      ...blankedSourceInputs(contentsOrOptions),
    };
  }
  const contents = stagesRows
    ? []
    : await collectContents(historySourceOf(contentsOrOptions));
  if (isAsyncIterableContents(contentsOrOptions)) {
    return { contents, tools: maybeTools };
  }
  const rows = contentsOrOptions.requestRows;
  if (rows !== undefined && !stagesRows && contents.length !== rows.count)
    throw new Error('Provider request rows count changed');
  return { ...copyRequestSelection(contentsOrOptions), contents };
}

/**
 * Completes a call normalized for the rows route. The history is staged on the
 * request's scratch disk one row at a time and the call carries `requestRows`,
 * so no history array exists.
 */
export async function attachDeferredHistory(
  normalized: NormalizedGenerateChatOptions,
  contentsOrOptions: AsyncIterable<IContent> | GenerateChatOptions,
): Promise<NormalizedGenerateChatOptions> {
  const source = isAsyncIterableContents(contentsOrOptions)
    ? { contents: contentsOrOptions, tools: normalized.tools }
    : contentsOrOptions;
  const scope = acquireRequestRows(
    source,
    undefined,
    getRequestSignal(normalized),
  );
  try {
    const rows = await providerRowsOf(scope.options);
    return {
      ...normalized,
      contents: [],
      requestRows: { ...rows, close: () => scope.close() },
      contentCount: rows.count,
      stagedRows: scope,
      ...blankedSourceInputs(normalized),
    };
  } catch (error) {
    return closeStagedRowsAfterFailure(scope, error);
  }
}

/**
 * Closes the staging of a call that failed and rethrows the failure. A close
 * that also fails is reported together with the primary failure.
 */
export async function closeStagedRowsAfterFailure(
  staged: Pick<RequestRowsScope, 'close'> | undefined,
  error: unknown,
): Promise<never> {
  try {
    await staged?.close();
  } catch (closeError) {
    throw new AggregateError(
      [error, closeError],
      'Request failed and its staged rows could not be closed',
    );
  }
  throw error;
}

export function assertProviderRequestData(
  input: RuntimeGuardInput,
): RuntimeGuardResult {
  const missingFields = [...findResolvedRuntimeGaps(input.resolved)];
  if (missingFields.length > 0) {
    throw new MissingProviderRuntimeError({
      providerKey: input.providerKey,
      missingFields,
      stage: input.stage,
      metadata: {
        ...(input.metadata ?? {}),
        requirement: 'REQ-SP4-001',
      },
    });
  }

  const metadata = buildRuntimeMetadata(input);
  return { metadata };
}

function createResolvedOptions(
  providedOptions: MaterializedGenerateChatOptions,
  deps: NormalizationDependencies,
): NormalizedGenerateChatOptions['resolved'] {
  const admitted = providedOptions.modelParameters?.modelParams;
  const temperature = admitted?.['temperature'];
  const maxTokens = admitted?.['maxTokens'];
  const admittedTemperature =
    typeof temperature === 'number' ? temperature : undefined;
  const admittedMaxTokens =
    typeof maxTokens === 'number' ? maxTokens : undefined;
  const temperatureDefault =
    admitted === undefined
      ? deps.providerSettings.temperature
      : admittedTemperature;
  const maxTokensDefault =
    admitted === undefined
      ? deps.providerSettings.maxTokens
      : admittedMaxTokens;
  return {
    model: providedOptions.resolved?.model ?? deps.resolvedModel,
    baseURL: providedOptions.resolved?.baseURL ?? deps.resolvedBaseURL,
    authToken: providedOptions.resolved?.authToken ?? deps.authToken,
    ...(providedOptions.resolved?.authToken === undefined &&
    deps.authFailure !== undefined
      ? { authFailure: deps.authFailure }
      : {}),
    telemetry: providedOptions.resolved?.telemetry,
    temperature: providedOptions.resolved?.temperature ?? temperatureDefault,
    maxTokens: providedOptions.resolved?.maxTokens ?? maxTokensDefault,
    streaming:
      providedOptions.resolved?.streaming ?? deps.providerSettings.streaming,
  };
}

function mergeInvocationMetadata(
  providedOptions: MaterializedGenerateChatOptions,
): Record<string, unknown> {
  return {
    ...(providedOptions.metadata ?? {}),
  };
}

/**
 * Determines whether a value conforms to the RuntimeInvocationContext contract.
 * A malformed stub (e.g. { signal } or { ephemerals: {} }) created by retry
 * orchestration or legacy callers lacks the helper methods and must not be
 * trusted as a real invocation context.
 */
const INVOCATION_METHODS = [
  'getModelBehavior',
  'getCliSetting',
  'getEphemeral',
  'getModelParam',
  'getProviderOverrides',
] as const;

export function isRuntimeInvocationContext(
  value: unknown,
): value is RuntimeInvocationContext {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return INVOCATION_METHODS.every(
    (method) => typeof candidate[method] === 'function',
  );
}

/**
 * Extracts a legacy AbortSignal smuggled onto a malformed invocation stub so
 * it can be preserved when a fresh RuntimeInvocationContext is created.
 */
function extractLegacySignal(invocation: unknown): AbortSignal | undefined {
  if (invocation === null || typeof invocation !== 'object') {
    return undefined;
  }
  const signal = (invocation as { signal?: unknown }).signal;
  return isAbortSignal(signal) ? signal : undefined;
}

interface InvocationNormalizationInput {
  invocation?: RuntimeInvocationContext;
  runtimeId?: string;
  runtimeMetadata?: Record<string, unknown>;
  modelParams?: Readonly<Record<string, unknown>>;
  modelParamsProviderName?: string;
  metadataSignal?: AbortSignal;
  userMemory?: string;
  providerName: string;
  snapshot: Readonly<Record<string, unknown>>;
  providerDefaults: Readonly<Record<string, unknown>>;
  configuredHeaders: Readonly<Record<string, string>>;
  telemetry: NormalizedGenerateChatOptions['resolved']['telemetry'];
  metadata: Record<string, unknown>;
}

function createNormalizedInvocation(
  input: InvocationNormalizationInput,
): RuntimeInvocationContext {
  const providedInvocation = isRuntimeInvocationContext(input.invocation)
    ? input.invocation
    : undefined;
  const metadataSignal = input.metadataSignal;
  const legacySignal = extractLegacySignal(input.invocation) ?? metadataSignal;
  if (providedInvocation) {
    const providedSignal = extractLegacySignal(providedInvocation);
    return createRuntimeInvocationContext({
      runtimeId: providedInvocation.runtimeId,
      sessionId: providedInvocation.sessionId,
      runtimeMetadata: input.runtimeMetadata,
      modelParams: input.modelParams,
      modelParamsProviderName: input.modelParamsProviderName,
      providerName: input.providerName,
      ephemeralsSnapshot: input.snapshot,
      providerDefaults:
        Object.keys(providedInvocation.providerDefaults).length > 0
          ? providedInvocation.providerDefaults
          : input.providerDefaults,
      configuredHeaders: {
        ...input.configuredHeaders,
        ...providedInvocation.customHeaders,
      },
      telemetry: providedInvocation.telemetry ?? input.telemetry,
      metadata: providedInvocation.metadata,
      userMemory: providedInvocation.userMemory,
      redaction: providedInvocation.redaction,
      ...((providedSignal ?? metadataSignal)
        ? { signal: providedSignal ?? metadataSignal }
        : {}),
      fallbackRuntimeId: providedInvocation.runtimeId,
    });
  }

  return createRuntimeInvocationContext({
    runtimeId: input.runtimeId,
    runtimeMetadata: input.runtimeMetadata,
    modelParams: input.modelParams,
    modelParamsProviderName: input.modelParamsProviderName,
    providerName: input.providerName,
    ephemeralsSnapshot: input.snapshot,
    providerDefaults: input.providerDefaults,
    configuredHeaders: input.configuredHeaders,
    telemetry: input.telemetry,
    metadata: input.metadata,
    userMemory: input.userMemory,
    ...(legacySignal ? { signal: legacySignal } : {}),
    fallbackRuntimeId: `${input.providerName}:normalizeGenerateChatOptions`,
  });
}

export function normalizeProviderGenerateChatOptions(
  provider: BaseProvider,
  providedOptions: MaterializedGenerateChatOptions,
  deps: NormalizationDependencies,
): NormalizedGenerateChatOptions {
  const metadata = mergeInvocationMetadata(providedOptions);
  const resolved = createResolvedOptions(providedOptions, deps);
  const guard = assertProviderRequestData({
    providerKey: `BaseProvider.${deps.providerName}`,
    metadata,
    resolved,
    stage: 'normalizeGenerateChatOptions',
  });
  const invocation = createNormalizedInvocation({
    invocation: providedOptions.invocation,
    runtimeId:
      providedOptions.invocation?.runtimeId ??
      (typeof guard.metadata.runtimeId === 'string'
        ? guard.metadata.runtimeId.trim()
        : undefined),
    runtimeMetadata: guard.metadata,
    modelParams: providedOptions.modelParameters?.modelParams,
    modelParamsProviderName: providedOptions.modelParameters?.providerName,
    metadataSignal: extractLegacySignal({
      signal: providedOptions.metadata?.abortSignal,
    }),
    userMemory:
      typeof providedOptions.userMemory === 'string'
        ? providedOptions.userMemory
        : undefined,
    providerName: deps.providerName,
    snapshot: deps.ephemeralsSnapshot,
    providerDefaults: deps.providerDefaults,
    configuredHeaders: deps.configuredHeaders,
    telemetry: resolved.telemetry,
    metadata: guard.metadata,
  });

  return {
    ...providedOptions,
    contents: providedOptions.contents,
    tools: providedOptions.tools ?? deps.maybeTools,
    metadata: guard.metadata,
    resolved,
    invocation,
  };
}

/** The provider's own temperature, token limit and streaming policy. */
export function readProviderSettings(
  capturedPolicy: Readonly<Record<string, unknown>>,
  providerName: string,
): ProviderSettings {
  const snapshot = readInvocationPolicyRecord(capturedPolicy[providerName]);
  return {
    temperature:
      typeof snapshot.temperature === 'number'
        ? snapshot.temperature
        : undefined,
    maxTokens:
      typeof snapshot.maxTokens === 'number' ? snapshot.maxTokens : undefined,
    streaming:
      typeof snapshot.streaming === 'boolean' ? snapshot.streaming : undefined,
  };
}
