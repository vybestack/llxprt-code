import {
  STRUCTURED_ERROR_CATEGORIES,
  type StructuredError,
  type StructuredErrorCategory,
} from '@vybestack/llxprt-code-core/core/turn.js';
import { isNetworkTransientError } from '@vybestack/llxprt-code-core/utils/retry.js';
import type { GenerateChatOptions } from './IProvider.js';

const PROVIDER_ERROR_OBSERVATION_CONTEXT_KEY =
  '_providerErrorObservationContext';
const MAX_HANDLED_PRIMITIVE_ERRORS = 32;

interface ProviderErrorObservationContext {
  readonly handledObjects: WeakSet<object>;
  readonly handledPrimitives: Set<unknown>;
}

interface DetachedProviderErrorObservationContext {
  readonly context: ProviderErrorObservationContext;
  readonly active: boolean;
}

export interface AttachedProviderErrorObservationContext {
  readonly options: GenerateChatOptions;
  release(): void;
}

const detachedObservationContexts = new WeakMap<
  GenerateChatOptions,
  DetachedProviderErrorObservationContext
>();

function getProviderErrorObservationContext(
  options: GenerateChatOptions,
): ProviderErrorObservationContext | undefined {
  const context = options.metadata?.[PROVIDER_ERROR_OBSERVATION_CONTEXT_KEY];
  if (typeof context !== 'object' || context === null) return undefined;
  if (!('handledObjects' in context) || !('handledPrimitives' in context)) {
    return undefined;
  }
  if (
    !(context.handledObjects instanceof WeakSet) ||
    !(context.handledPrimitives instanceof Set)
  ) {
    return undefined;
  }
  return {
    handledObjects: context.handledObjects,
    handledPrimitives: context.handledPrimitives,
  };
}

function createProviderErrorObservationContext(): ProviderErrorObservationContext {
  return {
    handledObjects: new WeakSet<object>(),
    handledPrimitives: new Set<unknown>(),
  };
}

function getOrCreateProviderErrorObservationContext(
  options: GenerateChatOptions,
): ProviderErrorObservationContext {
  const attached = getProviderErrorObservationContext(options);
  if (attached !== undefined) return attached;
  const detached = detachedObservationContexts.get(options);
  if (detached !== undefined) return detached.context;
  const context = createProviderErrorObservationContext();
  detachedObservationContexts.set(options, { context, active: false });
  return context;
}

function isObjectError(error: unknown): error is object {
  return (
    (typeof error === 'object' && error !== null) || typeof error === 'function'
  );
}

function hasHandledError(
  context: ProviderErrorObservationContext,
  error: unknown,
): boolean {
  return isObjectError(error)
    ? context.handledObjects.has(error)
    : context.handledPrimitives.has(error);
}

function markHandledError(
  context: ProviderErrorObservationContext,
  error: unknown,
): void {
  if (isObjectError(error)) {
    context.handledObjects.add(error);
  } else {
    if (context.handledPrimitives.size >= MAX_HANDLED_PRIMITIVE_ERRORS) {
      const oldest = context.handledPrimitives.values().next();
      if (oldest.done !== true) context.handledPrimitives.delete(oldest.value);
    }
    context.handledPrimitives.add(error);
  }
}

export function attachProviderErrorObservationContext(
  options: GenerateChatOptions,
): AttachedProviderErrorObservationContext {
  if (getProviderErrorObservationContext(options) !== undefined) {
    return { options, release: () => undefined };
  }
  const detached = detachedObservationContexts.get(options);
  const context =
    detached === undefined || detached.active
      ? createProviderErrorObservationContext()
      : detached.context;
  const lifecycle = { context, active: true };
  detachedObservationContexts.set(options, lifecycle);
  let released = false;
  return {
    options: {
      ...options,
      metadata: {
        ...options.metadata,
        [PROVIDER_ERROR_OBSERVATION_CONTEXT_KEY]: context,
      },
    },
    release: () => {
      if (released) return;
      released = true;
      if (detachedObservationContexts.get(options) === lifecycle) {
        detachedObservationContexts.delete(options);
      }
    },
  };
}

export async function* withProviderErrorObservationContext<T>(
  options: GenerateChatOptions,
  generate: (options: GenerateChatOptions) => AsyncIterableIterator<T>,
): AsyncGenerator<T> {
  const observation = attachProviderErrorObservationContext(options);
  try {
    yield* generate(observation.options);
  } finally {
    observation.release();
  }
}

export function claimProviderErrorObservation(
  options: GenerateChatOptions,
  error: unknown,
): boolean {
  if (options.onProviderError === undefined) return false;
  const context = getOrCreateProviderErrorObservationContext(options);
  if (hasHandledError(context, error)) return false;
  markHandledError(context, error);
  return true;
}

export function markProviderErrorObservationHandled(
  options: GenerateChatOptions,
  error: unknown,
): void {
  if (options.onProviderError === undefined) return;
  markHandledError(getOrCreateProviderErrorObservationContext(options), error);
}

export function invokeProviderErrorObserver(
  observer: ((error: StructuredError) => unknown) | undefined,
  error: StructuredError,
  onFailure: (failure: unknown) => void,
): void {
  if (observer === undefined) return;
  try {
    const result = observer(error);
    void Promise.resolve(result).catch(onFailure);
  } catch (failure) {
    onFailure(failure);
  }
}

export const MAX_PUBLIC_PROVIDER_MESSAGE_LENGTH = 512;
export const MAX_PUBLIC_PROVIDER_LABEL_LENGTH = 64;
export const MAX_PUBLIC_PROVIDER_LABELS = 8;
const FALLBACK_PROVIDER_MESSAGE = 'Provider request failed';
const MAX_ASCII_CONTROL_CHARACTER_CODE = 31;
const MIN_C1_CONTROL_CHARACTER_CODE = 127;
const MAX_C1_CONTROL_CHARACTER_CODE = 159;

function readStringProperty(
  value: unknown,
  property: string,
): string | undefined {
  if (typeof value !== 'object' || value === null || !(property in value)) {
    return undefined;
  }
  const propertyValue = (value as Record<string, unknown>)[property];
  return typeof propertyValue === 'string' ? propertyValue : undefined;
}

function unwrapTwoLevelProviderErrorEnvelope(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('error' in error)) {
    return error;
  }
  const envelope = error.error;
  if (typeof envelope !== 'object' || envelope === null) return error;
  if ('error' in envelope) return envelope.error;
  return envelope;
}

function getJsonDetail(message: string): unknown {
  const jsonStart = message.indexOf('{');
  if (jsonStart < 0) return undefined;
  try {
    return unwrapTwoLevelProviderErrorEnvelope(
      JSON.parse(message.slice(jsonStart)),
    );
  } catch {
    return undefined;
  }
}

export function normalizePublicProviderText(
  value: string,
  maximumLength = MAX_PUBLIC_PROVIDER_MESSAGE_LENGTH,
  fallback = FALLBACK_PROVIDER_MESSAGE,
): string {
  const normalized = Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0);
      if (
        code <= MAX_ASCII_CONTROL_CHARACTER_CODE ||
        (code >= MIN_C1_CONTROL_CHARACTER_CODE &&
          code <= MAX_C1_CONTROL_CHARACTER_CODE)
      ) {
        return ' ';
      }
      return character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const safeValue = normalized === '' ? fallback : normalized;
  const codePoints = Array.from(safeValue);
  if (codePoints.length <= maximumLength) return safeValue;
  return `${codePoints.slice(0, Math.max(0, maximumLength - 1)).join('')}…`;
}

export function formatPublicProviderMessage(
  prefix: string,
  detail?: string,
): string {
  const normalizedPrefix = normalizePublicProviderText(prefix);
  const combined =
    detail === undefined ? normalizedPrefix : `${normalizedPrefix}: ${detail}`;
  return normalizePublicProviderText(combined);
}

export function getSafeProviderLabel(value: string): string {
  return normalizePublicProviderText(
    value,
    MAX_PUBLIC_PROVIDER_LABEL_LENGTH,
    'unknown',
  );
}

export function summarizeProviderLabels(values: readonly string[]): string {
  const displayed = values
    .slice(0, MAX_PUBLIC_PROVIDER_LABELS)
    .map(getSafeProviderLabel);
  const omitted = values.length - displayed.length;
  return `${displayed.join(', ') || 'none'}${omitted > 0 ? ` (+${omitted} more)` : ''}`;
}

export function getSafeProviderMessage(error: unknown): string {
  if (typeof error === 'string') {
    const jsonDetail = getJsonDetail(error);
    const jsonMessage = readStringProperty(jsonDetail, 'message');
    return normalizePublicProviderText(jsonMessage ?? error);
  }
  const detail = unwrapTwoLevelProviderErrorEnvelope(error);
  const detailMessage =
    detail === error ? undefined : readStringProperty(detail, 'message');
  if (detailMessage !== undefined)
    return normalizePublicProviderText(detailMessage);

  const directMessage = readStringProperty(error, 'message');
  if (directMessage !== undefined) {
    const jsonDetail = getJsonDetail(directMessage);
    const jsonMessage = readStringProperty(jsonDetail, 'message');
    return normalizePublicProviderText(jsonMessage ?? directMessage);
  }
  if (error instanceof Error) {
    const jsonMessage = readStringProperty(
      getJsonDetail(error.message),
      'message',
    );
    return normalizePublicProviderText(jsonMessage ?? error.message);
  }
  return FALLBACK_PROVIDER_MESSAGE;
}

function getProviderType(error: unknown): string | undefined {
  return (
    readStringProperty(unwrapTwoLevelProviderErrorEnvelope(error), 'type') ??
    readStringProperty(error, 'type')
  );
}

function isStructuredErrorCategory(
  value: unknown,
): value is StructuredErrorCategory {
  return (
    typeof value === 'string' &&
    STRUCTURED_ERROR_CATEGORIES.some((category) => category === value)
  );
}

export function isStreamTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Stream timeout');
}

export function classifyProviderError(
  error: unknown,
  status: number | undefined,
): StructuredErrorCategory | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'category' in error &&
    isStructuredErrorCategory(error.category)
  ) {
    return error.category;
  }
  const providerType = getProviderType(error);
  if (status === 429 || providerType === 'rate_limit_error')
    return 'rate_limit';
  if (status === 402) return 'quota';
  if (status === 401 || status === 403) return 'authentication';
  if (providerType === 'overloaded_error' || providerType === 'api_error') {
    return 'server_error';
  }
  if (status !== undefined && status >= 500 && status < 600) {
    return 'server_error';
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return 'client_error';
  }
  if (isNetworkTransientError(error)) return 'network';
  if (isStreamTimeoutError(error)) return 'server_error';
  return undefined;
}

export function getEffectiveProviderStatus(
  _error: unknown,
  status: number | undefined,
  category: StructuredErrorCategory | undefined,
): number | undefined {
  if (status !== undefined) return status;
  if (category === 'rate_limit') return 429;
  if (category === 'quota') return 402;
  return undefined;
}

export function toObservedProviderError(
  error: unknown,
  status: number | undefined,
  category: StructuredErrorCategory | undefined,
): StructuredError {
  const effectiveStatus = getEffectiveProviderStatus(error, status, category);
  return {
    message: getSafeProviderMessage(error),
    ...(effectiveStatus !== undefined ? { status: effectiveStatus } : {}),
    ...(category !== undefined ? { category } : {}),
  };
}
