/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
// Scripts-only: imports plugin source, so agents code must never import this
// module (the agents tsc program would then require the plugin's dependencies).
import { GeminiProvider } from '../../plugins/google-gemini/src/gemini/GeminiProvider.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import type { ProviderRuntimeContext } from '../../packages/core/src/runtime/providerRuntimeContext.js';
import {
  captureCuratedBody as capturePackageBody,
  captureWithAdapter,
  type CuratedProviderAdapter,
} from './provider-curated-body-helpers.js';

const GEMINI_ADAPTER: CuratedProviderAdapter = {
  model: 'gemini-2.5-flash',
  makeProvider: () => new GeminiProvider('test-key'),
  // The capture invocation sets streaming to "disabled", and the provider
  // now reads that from the admitted invocation, so it calls generateContent.
  response: () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
};

/** Captures request bodies for package-hosted providers and the Gemini plugin. */
export function captureCuratedBody(
  name: string,
  contents: Iterable<IContent> | AsyncIterable<IContent>,
  caching = false,
  retry = false,
  orchestrated = false,
  responseContents?: IContent[],
  mediaResolver?: ProviderRuntimeContext['mediaResolver'],
): Promise<string> {
  if (name !== 'gemini')
    return capturePackageBody(
      name,
      contents,
      caching,
      retry,
      orchestrated,
      responseContents,
      mediaResolver,
    );
  return captureWithAdapter(
    name,
    GEMINI_ADAPTER,
    contents,
    caching,
    retry,
    orchestrated,
    responseContents,
    mediaResolver,
  );
}
