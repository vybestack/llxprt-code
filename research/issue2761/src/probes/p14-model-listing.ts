/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P14 — model listing.
 *
 * llxprt's `geminiModels.fetchModelsFromApi` lists models with bare `fetch`
 * (no SDK), and `@google/genai` exposes `models.list`. This probe records
 * all three evidence surfaces: the `@google/genai` SDK listing, the AI SDK
 * provider surface (runtime key enumeration), and a bare fetch against
 * `/v1beta/models` (the llxprt path).
 */

import type { GoogleGenerativeAIProvider } from '@ai-sdk/google';

import { createAISDK } from '../adapters/aisdk.ts';
import { createGenAI } from '../adapters/genai.ts';
import {
  ADAPTER_AISDK,
  ADAPTER_GENAI,
  observe,
  type Probe,
  type ProbeResult,
} from '../harness.ts';

function providerKeyEvidence(provider: GoogleGenerativeAIProvider): {
  ownKeys: string[];
  hasList: boolean;
  languageModel: boolean;
  tools: string[];
} {
  const keys = Object.keys(provider);
  return {
    ownKeys: keys.sort(),
    hasList: keys.includes('list'),
    languageModel: typeof provider.languageModel === 'function',
    tools: Object.keys(provider.tools ?? {}).sort(),
  };
}

export const p14ModelListing: Probe = {
  id: 'P14',
  area: 'Model listing',
  run: async (ctx): Promise<ProbeResult> => {
    const genai = await observe(ADAPTER_GENAI, async () => {
      const client = createGenAI(ctx.apiKey);
      const pager = await client.models.list({
        config: { pageSize: 10 },
      });
      const page = pager.page ?? [];
      return {
        sdkOffersListing: true,
        keyMethod: 'models.list',
        modelCount: page.length,
        firstIds: page
          .map((m) => m.name)
          .filter((n) => typeof n === 'string')
          .slice(0, 5),
      };
    });

    // Reproduces exactly what geminiModels.fetchModelsFromApi does today: a
    // bare fetch against /v1beta/models with the key as a query parameter.
    // It is recorded on the AI SDK side because that is the side whose missing
    // listing API it would have to stand in for.
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${ctx.apiKey}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const json = (await res.json()) as { models?: Array<{ name?: string }> };
    const bareFetch = {
      status: res.status,
      modelCount: (json.models ?? []).length,
      firstIds: (json.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => typeof n === 'string')
        .slice(0, 5),
    };

    const aisdk = await observe(ADAPTER_AISDK, async () => {
      const provider = createAISDK(ctx.apiKey);
      const keys = providerKeyEvidence(provider);
      return {
        sdkOffersListing: keys.hasList,
        methodNames: keys.ownKeys,
        languageModelFactory: keys.languageModel,
        providerTools: keys.tools,
        llxprtBareFetchListing: bareFetch,
      };
    });

    const genaiListed =
      genai.ok && typeof genai.observation.modelCount === 'number';
    const aisdkOffersListing = aisdk.observation.sdkOffersListing === true;

    return {
      id: 'P14',
      area: 'Model listing',
      question:
        'Do both adapters offer a listing path, and is the AI SDK missing one ' +
        'a real gap given llxprt lists models with a bare fetch?',
      models: [],
      genai,
      aisdk,
      verdict: aisdkOffersListing || bareFetch.status === 200 ? 'parity' : 'gap',
      finding: `@google/genai exposes models.list (listed=${genaiListed}); ` +
        `@ai-sdk/google exposes no listing method (sdkOffersListing=${aisdkOffersListing}). ` +
        `That costs llxprt nothing here: geminiModels.fetchModelsFromApi already ` +
        `lists with a bare fetch against /v1beta/models, which returned ` +
        `${bareFetch.modelCount} models at status ${bareFetch.status} in this run, ` +
        `and the provider never calls the SDK for listing.`,
    };
  },
};
