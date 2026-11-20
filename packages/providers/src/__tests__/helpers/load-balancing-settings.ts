/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { GenerateChatOptions } from '../../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
export async function* generateSignalAwareResponse(
  options: GenerateChatOptions,
  captureSignal: (signal: AbortSignal) => void,
): AsyncGenerator<IContent> {
  const signal = options.invocation?.signal;
  if (signal === undefined) {
    throw new Error('Delegate invocation signal is required');
  }
  captureSignal(signal);
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
  yield { speaker: 'ai', blocks: [{ type: 'text', text: 'response' }] };
}

export function captureResolvedAuthToken(
  options: GenerateChatOptions,
  capturedAuthTokens: Array<
    NonNullable<GenerateChatOptions['resolved']>['authToken']
  >,
): void {
  if (options.resolved?.authToken != null) {
    capturedAuthTokens.push(options.resolved.authToken);
  }
}

export function captureResolvedBaseUrl(
  options: GenerateChatOptions,
  capturedBaseUrls: string[],
): void {
  if (options.resolved?.baseURL != null) {
    capturedBaseUrls.push(options.resolved.baseURL);
  }
}

export function optionsOnly(
  options: GenerateChatOptions | AsyncIterable<IContent>,
): GenerateChatOptions {
  if (Symbol.asyncIterator in options)
    throw new Error('Expected request options');
  return options;
}
