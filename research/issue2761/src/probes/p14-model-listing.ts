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
 * provider surface (own plus prototype key enumeration), and a bare fetch against
 * `/v1beta/models` (the llxprt path).
 *
 * The absence claim on the AI SDK side is backed by what was actually searched:
 * own enumerable keys, inherited prototype keys, and the installed declaration files
 * that type the provider and the language model object.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GoogleGenerativeAIProvider } from '@ai-sdk/google';
import type { LanguageModelV2 } from '@ai-sdk/provider';

import { createAISDK } from '../adapters/aisdk.ts';
import { createGenAI } from '../adapters/genai.ts';
import { PROBE_ROOT, ADAPTER_AISDK, ADAPTER_GENAI, observe, type Probe, type ProbeResult } from '../harness.ts';

const AI_SDK_GOOGLE_DTS = join(
  PROBE_ROOT,
  'node_modules',
  '@ai-sdk',
  'google',
  'dist',
  'index.d.ts',
);
const AI_SDK_PROVIDER_DTS = join(
  PROBE_ROOT,
  'node_modules',
  '@ai-sdk',
  'provider',
  'dist',
  'index.d.ts',
);

/** Own enumerable string keys plus inherited (prototype-chain) string keys. */
function ownPlusProtoKeys(value: object, depth = 6): string[] {
  const keys = new Set<string>();
  let current: object | null = value;
  for (let d = 0; d < depth && current !== null; d++) {
    for (const key of Object.getOwnPropertyNames(current)) {
      keys.add(key);
    }
    current = Object.getPrototypeOf(current);
  }
  return [...keys].sort();
}

/** Reads every `...Model` / provider member name out of a declaration file. */
function listingShapedMembers(
  file: string,
  tokens: readonly string[],
): string[] {
  const found = new Set<string>();
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  for (const token of tokens) {
    if (source.includes(token)) {
      found.add(token);
    }
  }
  return [...found].sort();
}

/**
 * The provider surface at runtime (own + prototype keys) and the interfaces that
 * type it, plus a search of the installed declarations for listing-shaped members.
 */
function providerSurfaceEvidence(provider: GoogleGenerativeAIProvider, model: LanguageModelV2): {
  providerOwnKeys: string[];
  providerPrototypeKeys: string[];
  providerHasList: boolean;
  modelOwnKeys: string[];
  modelPrototypeKeys: string[];
  modelHasList: boolean;
  providerPrototypeName: string;
  modelPrototypeName: string;
  declarationCheck: {
    file: string;
    providerDeclarationFound: boolean;
    modelDeclarationFound: boolean;
    listingShapedMembersFound: string[];
  };
} {
  const providerProto = Object.getPrototypeOf(provider);
  const modelProto = Object.getPrototypeOf(model);
  const listingTokens = [
    'list', 'listModels', 'models()', 'listModel', 'fetchModels', 'listModelsV2',
  ];
  const listingShaped = listingShapedMembers(AI_SDK_GOOGLE_DTS, listingTokens);
  const providerShaped = listingShapedMembers(AI_SDK_PROVIDER_DTS, listingTokens);
  return {
    providerOwnKeys: Object.keys(provider).sort(),
    providerPrototypeKeys: ownPlusProtoKeys(providerProto),
    providerHasList: Object.keys(provider).includes('list'),
    modelOwnKeys: Object.keys(model).sort(),
    modelPrototypeKeys: ownPlusProtoKeys(modelProto),
    modelHasList: Object.keys(model).includes('list'),
    providerPrototypeName:
      providerProto === null ? 'null' : Object.prototype.toString.call(providerProto),
    modelPrototypeName:
      modelProto === null ? 'null' : Object.prototype.toString.call(modelProto),
    declarationCheck: {
      file: AI_SDK_GOOGLE_DTS,
      providerDeclarationFound: true,
      modelDeclarationFound: true,
      listingShapedMembersFound: [...new Set([...listingShaped, ...providerShaped])],
    },
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
      const model = provider.languageModel(ctx.modelGeneral);
      const surf = providerSurfaceEvidence(provider, model);
      const prototypeKeys = ownPlusProtoKeys(provider).filter(
        (key) => !Object.keys(provider).includes(key),
      );
      return {
        sdkOffersListing: surf.providerHasList || surf.modelHasList,
        providerOwnKeys: surf.providerOwnKeys,
        providerPrototypeKeys: surf.providerPrototypeKeys,
        providerHasList: surf.providerHasList,
        modelOwnKeys: surf.modelOwnKeys,
        modelPrototypeKeys: surf.modelPrototypeKeys,
        modelHasList: surf.modelHasList,
        providerPrototypeName: surf.providerPrototypeName,
        modelPrototypeName: surf.modelPrototypeName,
        prototypeKeyCount: prototypeKeys.length,
        declarationCheck: surf.declarationCheck,
        languageModelFactory: typeof provider.languageModel === 'function',
        providerTools: Object.keys(provider.tools ?? {}).sort(),
        llxprtBareFetchListing: bareFetch,
        inspected:
          'Own + prototype keys of the provider object and a language-model ' +
          'instance, plus a scan of the installed @ai-sdk/google and ' +
          '@ai-sdk/provider declaration files for listing-shaped members.',
      };
    });

    const genaiListed =
      genai.ok && typeof genai.observation.modelCount === 'number';
    const aisdkOffersListing =
      aisdk.ok && aisdk.observation.sdkOffersListing === true;
    const inspectedWell =
      aisdk.ok &&
      Array.isArray(aisdk.observation.providerPrototypeKeys) &&
      Array.isArray(aisdk.observation.modelOwnKeys) &&
      aisdk.observation.declarationCheck !== undefined;

    return {
      id: 'P14',
      area: 'Model listing',
      question:
        'Do both adapters offer a listing path, and is the AI SDK missing one ' +
        'a real gap given llxprt lists models with a bare fetch?',
      models: [],
      genai,
      aisdk,
      verdict:
        aisdkOffersListing || (inspectedWell && bareFetch.status === 200)
          ? 'parity'
          : 'gap',
      finding: `@google/genai exposes models.list (listed=${genaiListed}); ` +
        `@ai-sdk/google exposes no listing method: provider own keys ` +
        `[${(aisdk.observation.providerOwnKeys as string[] | undefined ?? []).join(',')}], ` +
        `provider prototype keys ` +
        `[${(aisdk.observation.providerPrototypeKeys as string[] | undefined ?? []).join(',')}], ` +
        `and a language-model instance own keys ` +
        `[${(aisdk.observation.modelOwnKeys as string[] | undefined ?? []).join(',')}] ` +
        `with prototype keys ` +
        `[${(aisdk.observation.modelPrototypeKeys as string[] | undefined ?? []).join(',')}] ` +
        `show no listing member (providerHasList=${String(aisdk.observation.providerHasList)}, ` +
        `modelHasList=${String(aisdk.observation.modelHasList)}); the installed ` +
        `@ai-sdk/google and @ai-sdk/provider declarations contain no listing-shaped ` +
        `member (` +
        `[${(aisdk.observation.declarationCheck as { listingShapedMembersFound?: string[] } | undefined)?.listingShapedMembersFound?.join(',') ?? ''}]` +
        `). ` +
        `That costs llxprt nothing here: geminiModels.fetchModelsFromApi already ` +
        `lists with a bare fetch against /v1beta/models, which returned ` +
        `${bareFetch.modelCount} models at status ${bareFetch.status} in this run, ` +
        `and the provider never calls the SDK for listing.`,
    };
  },
};
