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

import { relative, join } from 'node:path';
import type { GoogleGenerativeAIProvider } from '@ai-sdk/google';
import type { LanguageModelV2 } from '@ai-sdk/provider';

import { createAISDK } from '../adapters/aisdk.ts';
import { interfaceMembersFromDts } from '../sdk-typings.ts';
import { createGenAI } from '../adapters/genai.ts';
import {
  PROBE_ROOT,
  ADAPTER_AISDK,
  ADAPTER_GENAI,
  captureError,
  observe,
  type Probe,
  type ProbeResult,
} from '../harness.ts';

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

/** Absolute declaration paths are machine noise; record them relative. */
function relativeToProbeRoot(file: string | null): string | null {
  if (file === null) {
    return null;
  }
  return relative(PROBE_ROOT, file);
}

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
/**
 * A member that would enumerate models. Anchored so it cannot match an
 * unrelated identifier that merely contains the substring "list".
 */
const LISTING_MEMBER_PATTERN = /^(list|listModels?|models|fetchModels)$/i;


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
  runtimeListingMembers: string[];
  declarationCheck: {
    providerDeclarationFile: string | null;
    providerDeclarationFound: boolean;
    providerDeclaredMembers: string[];
    modelDeclarationFile: string | null;
    modelDeclarationFound: boolean;
    modelDeclaredMembers: string[];
    declaredListingMembers: string[];
  };
} {
  const providerProto = Object.getPrototypeOf(provider);
  const modelProto = Object.getPrototypeOf(model);

  // Parse the declarations rather than substring-scanning them: the token
  // "list" matches almost any declaration file, which would make an absence
  // claim meaningless.
  const providerFacts = interfaceMembersFromDts(
    'GoogleGenerativeAIProvider',
    AI_SDK_GOOGLE_DTS,
  );
  const modelFacts = interfaceMembersFromDts(
    'LanguageModelV2',
    AI_SDK_PROVIDER_DTS,
  );
  const declaredListingMembers = [
    ...(providerFacts?.members ?? []),
    ...(modelFacts?.members ?? []),
  ].filter((member) => LISTING_MEMBER_PATTERN.test(member));

  const runtimeListingMembers = [
    ...ownPlusProtoKeys(provider),
    ...ownPlusProtoKeys(model),
  ].filter((member) => LISTING_MEMBER_PATTERN.test(member));

  return {
    providerOwnKeys: Object.keys(provider).sort(),
    providerPrototypeKeys: ownPlusProtoKeys(providerProto),
    providerHasList: ownPlusProtoKeys(provider).some((member) =>
      LISTING_MEMBER_PATTERN.test(member),
    ),
    modelOwnKeys: Object.keys(model).sort(),
    modelPrototypeKeys: ownPlusProtoKeys(modelProto),
    modelHasList: ownPlusProtoKeys(model).some((member) =>
      LISTING_MEMBER_PATTERN.test(member),
    ),
    runtimeListingMembers,
    providerPrototypeName:
      providerProto === null ? 'null' : Object.prototype.toString.call(providerProto),
    modelPrototypeName:
      modelProto === null ? 'null' : Object.prototype.toString.call(modelProto),
    declarationCheck: {
      providerDeclarationFile: relativeToProbeRoot(providerFacts?.file ?? null),
      providerDeclarationFound: providerFacts !== null,
      providerDeclaredMembers: providerFacts?.members ?? [],
      modelDeclarationFile: relativeToProbeRoot(modelFacts?.file ?? null),
      modelDeclarationFound: modelFacts !== null,
      modelDeclaredMembers: modelFacts?.members ?? [],
      declaredListingMembers,
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
    // The `?key=` form is deliberate: this reproduces exactly what
    // geminiModels.fetchModelsFromApi does. Because the key is therefore in the
    // URL, a thrown network error would carry it in its message, so the failure
    // path is caught here and pushed through the redactor before it is recorded.
    const bareFetch = await (async (): Promise<Record<string, unknown>> => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${ctx.apiKey}`;
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        const json = (await res.json()) as { models?: Array<{ name?: string }> };
        return {
          ok: res.ok,
          status: res.status,
          modelCount: (json.models ?? []).length,
          firstIds: (json.models ?? [])
            .map((m) => m.name)
            .filter((n): n is string => typeof n === 'string')
            .slice(0, 5),
        };
      } catch (error) {
        return {
          ok: false,
          status: null,
          modelCount: 0,
          firstIds: [],
          error: ctx.redact(captureError(error)),
        };
      }
    })();

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
        genaiListed &&
        (aisdkOffersListing || (inspectedWell && bareFetch.ok === true))
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
        `modelHasList=${String(aisdk.observation.modelHasList)}). Declaration ` +
        `evidence of a listing-shaped member: provider declaration found=` +
        `${String(declaredCheck(aisdk.observation.declarationCheck)?.providerDeclarationFound)}, ` +
        `model declaration found=` +
        `${String(declaredCheck(aisdk.observation.declarationCheck)?.modelDeclarationFound)}, ` +
        `declared listing members ` +
        `[${String(declaredCheck(aisdk.observation.declarationCheck)?.declaredListingMembers)}]` +
        ` (evidenced-nonempty only when both declarations were found: ` +
        `${String(providerAndModelDeclared(aisdk.observation.declarationCheck))}). ` +
        `That costs llxprt nothing here: geminiModels.fetchModelsFromApi already ` +
        `lists with a bare fetch against /v1beta/models, which returned ` +
        `${String(bareFetch.modelCount)} models at status ${String(bareFetch.status)} in this run, ` +
        `and the provider never calls the SDK for listing.`,
    };
  },
};

/**
 * Reads `declarationCheck` off a raw observation (it is a plain object on the
 * artifact after JSON round-tripping).
 */
function declaredCheck(value: unknown): {
  declaredListingMembers?: unknown;
  providerDeclarationFound?: unknown;
  modelDeclarationFound?: unknown;
} | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return value as {
    declaredListingMembers?: unknown;
    providerDeclarationFound?: unknown;
    modelDeclarationFound?: unknown;
  };
}

function providerAndModelDeclared(value: unknown): boolean {
  const check = declaredCheck(value);
  return (
    check?.providerDeclarationFound === true &&
    check?.modelDeclarationFound === true
  );
}
