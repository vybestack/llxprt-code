import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { getRequestSignal } from '../utils/abortSignal.js';

export { getRequestSignal } from '../utils/abortSignal.js';

export function rethrowIfAborted(
  error: unknown,
  options: GenerateChatOptions,
): void {
  if (error instanceof Error && error.name === 'AbortError') throw error;
  if (getRequestSignal(options)?.aborted === true) {
    const abortError = createAbortError() as Error & { cause?: unknown };
    abortError.cause = error;
    throw abortError;
  }
}
