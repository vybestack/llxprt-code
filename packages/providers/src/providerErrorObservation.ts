import type {
  StructuredError,
  StructuredErrorCategory,
} from '@vybestack/llxprt-code-core/core/turn.js';
import { isNetworkTransientError } from '@vybestack/llxprt-code-core/utils/retry.js';
import type { GenerateChatOptions } from './IProvider.js';

const PROVIDER_ERROR_OBSERVATION_CONTEXT_KEY =
  '_providerErrorObservationContext';

interface ProviderErrorObservationContext {
  readonly handledErrors: Set<unknown>;
}

function getProviderErrorObservationContext(
  options: GenerateChatOptions,
): ProviderErrorObservationContext | undefined {
  const context = options.metadata?.[PROVIDER_ERROR_OBSERVATION_CONTEXT_KEY];
  if (typeof context !== 'object' || context === null) return undefined;
  if (!('handledErrors' in context)) return undefined;
  return context.handledErrors instanceof Set
    ? { handledErrors: context.handledErrors }
    : undefined;
}

export function attachProviderErrorObservationContext(
  options: GenerateChatOptions,
): GenerateChatOptions {
  if (getProviderErrorObservationContext(options) !== undefined) return options;
  const context: ProviderErrorObservationContext = {
    handledErrors: new Set<unknown>(),
  };
  return {
    ...options,
    metadata: {
      ...options.metadata,
      [PROVIDER_ERROR_OBSERVATION_CONTEXT_KEY]: context,
    },
  };
}

export function claimProviderErrorObservation(
  options: GenerateChatOptions,
  error: unknown,
): boolean {
  if (options.onProviderError === undefined) return false;
  const context = getProviderErrorObservationContext(options);
  if (context === undefined) return true;
  if (context.handledErrors.has(error)) return false;
  context.handledErrors.add(error);
  return true;
}

export function markProviderErrorObservationHandled(
  options: GenerateChatOptions,
  error: unknown,
): void {
  if (options.onProviderError === undefined) return;
  getProviderErrorObservationContext(options)?.handledErrors.add(error);
}

export const MAX_PUBLIC_PROVIDER_MESSAGE_LENGTH = 512;
export const MAX_PUBLIC_PROVIDER_LABEL_LENGTH = 64;
export const MAX_PUBLIC_PROVIDER_LABELS = 8;
const FALLBACK_PROVIDER_MESSAGE = 'Provider request failed';

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

function getProviderDetail(error: unknown): unknown {
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
    return getProviderDetail(JSON.parse(message.slice(jsonStart)));
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
      if (code <= 31 || (code >= 127 && code <= 159)) return ' ';
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
  const detail = getProviderDetail(error);
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
    readStringProperty(getProviderDetail(error), 'type') ??
    readStringProperty(error, 'type')
  );
}

function isStructuredErrorCategory(
  value: unknown,
): value is StructuredErrorCategory {
  switch (value) {
    case 'rate_limit':
    case 'quota':
    case 'authentication':
    case 'server_error':
    case 'network':
    case 'client_error':
      return true;
    default:
      return false;
  }
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
  if (error instanceof Error && error.message.includes('Stream timeout')) {
    return 'server_error';
  }
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
