/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P05 — tool-parameter JSON Schema dialect.
 *
 * llxprt hand-cleans tool schemas today in
 * `packages/providers/src/gemini/geminiSchemaHelpers.ts` (`cleanGeminiSchema`)
 * and adds a missing top-level `type: OBJECT` in
 * `geminiRequestBuilding.buildGeminiTools`. The question this probe answers is
 * how much of that work `@ai-sdk/google` already does for us.
 *
 * Two schemas are sent, so one failure cannot mask the other:
 *
 *  - `DIALECT_SCHEMA`  — otherwise valid, but stuffed with JSON-Schema keywords
 *                        the Gemini dialect does not accept (`$schema`,
 *                        `title`, `additionalProperties`, `format`,
 *                        `exclusiveMinimum`, `anyOf`, `default`).
 *  - `UNTYPED_SCHEMA`  — a sub-schema with `properties` but no `type`, which is
 *                        the case `buildGeminiTools` patches by hand.
 *
 * Every case goes through the recording proxy so the evidence is the actual
 * wire body, captured whether the call succeeded or was rejected.
 */

import type { LanguageModelV2FunctionTool, LanguageModelV2Prompt } from '@ai-sdk/provider';
import type { JSONSchema7 } from '@ai-sdk/provider';

import { createAISDK } from '../adapters/aisdk.ts';
import { createGenAI } from '../adapters/genai.ts';
import {
  ADAPTER_AISDK,
  ADAPTER_GENAI,
  observe,
  type Probe,
  type ProbeContext,
  type ProbeResult,
} from '../harness.ts';
import { startRecordingProxy, type WireRecord } from '../recording.ts';

/** Structurally valid; every extra keyword is one Gemini rejects or ignores. */
const DIALECT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  title: 'PlaceOrder',
  description: 'A test order.',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  additionalProperties: false,
  properties: {
    nested: {
      type: 'object',
      additionalProperties: false,
      properties: {
        count: { type: 'number', minimum: 1, maximum: 10, exclusiveMinimum: 0 },
        label: { type: 'string', format: 'date-time' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['count'],
    },
    kind: { type: 'string', enum: ['a', 'b'], default: 'a' },
    either: { anyOf: [{ type: 'string' }, { type: 'number' }] },
  },
  required: ['nested'],
};

/** The `type`-less object case that `buildGeminiTools` patches by hand. */
const UNTYPED_SCHEMA: Record<string, unknown> = {
  properties: {
    who: { type: 'string' },
  },
};

const KEYWORDS_UNDER_TEST = [
  '$schema',
  'title',
  'additionalProperties',
  'format',
  'exclusiveMinimum',
  'anyOf',
  'default',
] as const;

const USER_TURN = 'Reply with a one-word answer.';

interface CaseOutcome {
  readonly accepted: boolean;
  readonly httpStatus: number | null;
  readonly providerError: string | null;
  /** The tool declarations exactly as they left the process. */
  readonly wireTools: unknown;
  /** Which fussy keywords survived onto the wire. */
  readonly keywordsOnWire: string[];
}

/**
 * Collects the JSON-Schema keywords that survived onto the wire.
 *
 * A substring scan of the serialized tools blob would count a PROPERTY named
 * `title`, or a description that happens to contain the word `default`, as the
 * schema keyword being present, and that feeds the verdict directly. This walks
 * the parsed request body instead and only counts a keyword when it appears as
 * an own key of a schema node, never as a property name under `properties`.
 */
function keywordsPresent(value: unknown): string[] {
  const found = new Set<string>();

  const walkSchema = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        walkSchema(entry);
      }
      return;
    }
    if (node === null || typeof node !== 'object') {
      return;
    }
    const record = node as Record<string, unknown>;
    for (const keyword of KEYWORDS_UNDER_TEST) {
      if (Object.prototype.hasOwnProperty.call(record, keyword)) {
        found.add(keyword);
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === 'properties') {
        // The keys here are property NAMES, not schema keywords. Descend into
        // the values only.
        if (child !== null && typeof child === 'object') {
          for (const sub of Object.values(child as Record<string, unknown>)) {
            walkSchema(sub);
          }
        }
        continue;
      }
      walkSchema(child);
    }
  };

  walkSchema(value);
  return KEYWORDS_UNDER_TEST.filter((keyword) => found.has(keyword));
}

function summarizeRecord(record: WireRecord | undefined): {
  wireTools: unknown;
  httpStatus: number | null;
  providerError: string | null;
} {
  if (record === undefined) {
    return { wireTools: null, httpStatus: null, providerError: null };
  }
  const body = record.requestBody as { tools?: unknown } | null;
  const wireTools = body?.tools ?? null;
  const errorMessage =
    record.status >= 400 ? record.responseBodyPreview.slice(0, 600) : null;
  return { wireTools, httpStatus: record.status, providerError: errorMessage };
}

async function runGenaiCase(
  ctx: ProbeContext,
  schema: Record<string, unknown>,
): Promise<CaseOutcome> {
  const proxy = await startRecordingProxy();
  let accepted = false;
  try {
    await createGenAI(ctx.apiKey, { baseUrl: proxy.origin }).models.generateContent({
      model: ctx.modelGeneral,
      contents: [{ role: 'user', parts: [{ text: USER_TURN }] }],
      config: {
        maxOutputTokens: 8,
        // Cast: the probe deliberately sends an UNCLEANED schema, which is
        // exactly what the Gemini `Schema` type forbids at compile time.
        tools: [
          {
            functionDeclarations: [
              {
                name: 'place_order',
                description: 'Place a test order.',
                parameters: schema,
              },
            ],
          },
        ] as never,
      },
    });
    accepted = true;
  } catch {
    accepted = false;
  } finally {
    await proxy.close();
  }
  const summary = summarizeRecord(proxy.records[0]);
  return {
    accepted,
    ...summary,
    keywordsOnWire: keywordsPresent(summary.wireTools),
  };
}

async function runAisdkCase(
  ctx: ProbeContext,
  schema: Record<string, unknown>,
): Promise<CaseOutcome> {
  const proxy = await startRecordingProxy();
  let accepted = false;
  try {
    const prompt: LanguageModelV2Prompt = [
      { role: 'user', content: [{ type: 'text', text: USER_TURN }] },
    ];
    const tool: LanguageModelV2FunctionTool = {
      type: 'function',
      name: 'place_order',
      description: 'Place a test order.',
      inputSchema: schema as JSONSchema7,
    };
    const provider = createAISDK(ctx.apiKey, {
      baseURL: `${proxy.origin}/v1beta`,
    });
    await provider.languageModel(ctx.modelGeneral).doGenerate({
      prompt,
      maxOutputTokens: 8,
      tools: [tool],
      toolChoice: { type: 'auto' },
    });
    accepted = true;
  } catch {
    accepted = false;
  } finally {
    await proxy.close();
  }
  const summary = summarizeRecord(proxy.records[0]);
  return {
    accepted,
    ...summary,
    keywordsOnWire: keywordsPresent(summary.wireTools),
  };
}

export const p05Schemas: Probe = {
  id: 'P05',
  area: 'Schemas',

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const cases: {
      dialectGenai?: CaseOutcome;
      untypedGenai?: CaseOutcome;
      dialectAisdk?: CaseOutcome;
      untypedAisdk?: CaseOutcome;
    } = {};

    const genai = await observe(ADAPTER_GENAI, async () => {
      cases.dialectGenai = await runGenaiCase(ctx, DIALECT_SCHEMA);
      await pause();
      cases.untypedGenai = await runGenaiCase(ctx, UNTYPED_SCHEMA);
      return {
        dialectKeywordCase: cases.dialectGenai,
        untypedObjectCase: cases.untypedGenai,
        note:
          'Schemas are sent UNCLEANED. llxprt normally runs cleanGeminiSchema ' +
          'and patches a missing top-level type before this point.',
      };
    });

    await pause();

    const aisdk = await observe(ADAPTER_AISDK, async () => {
      cases.dialectAisdk = await runAisdkCase(ctx, DIALECT_SCHEMA);
      await pause();
      cases.untypedAisdk = await runAisdkCase(ctx, UNTYPED_SCHEMA);
      return {
        dialectKeywordCase: cases.dialectAisdk,
        untypedObjectCase: cases.untypedAisdk,
      };
    });

    const dGenai = cases.dialectGenai;
    const dAisdk = cases.dialectAisdk;
    if (dGenai === undefined || dAisdk === undefined) {
      return {
        id: 'P05',
        area: 'Schemas',
        question: QUESTION,
        models: [ctx.modelGeneral],
        genai,
        aisdk,
        verdict: 'gap',
        finding:
          'The schema probe could not complete both adapter runs; see the ' +
          'recorded error.',
      };
    }

    // A 429 says nothing about schema handling, so it must not be read as a
    // dialect rejection.
    const inconclusive =
      isRateLimited(dGenai) ||
      isRateLimited(dAisdk) ||
      isRateLimited(cases.untypedGenai) ||
      isRateLimited(cases.untypedAisdk);

    const aisdkCleansDialect =
      dAisdk.accepted && dAisdk.keywordsOnWire.length === 0;
    const verdict: ProbeResult['verdict'] = inconclusive
      ? 'partial'
      : aisdkCleansDialect
        ? 'parity'
        : dAisdk.accepted
          ? 'partial'
          : 'gap';

    return {
      id: 'P05',
      area: 'Schemas',
      question: QUESTION,
      models: [ctx.modelGeneral],
      genai,
      aisdk,
      verdict,
      finding:
        `Uncleaned dialect schema: @google/genai forwarded it verbatim ` +
        `(keywords still on the wire: ${describeKeywords(dGenai)}), API ${describeOutcome(dGenai)}; ` +
        `@ai-sdk/google put ${describeKeywords(dAisdk)} on the wire, API ${describeOutcome(dAisdk)}. ` +
        `Untyped-object sub-schema: genai ${describeOutcome(cases.untypedGenai)}, ` +
        `ai-sdk ${describeOutcome(cases.untypedAisdk)}. ` +
        (inconclusive
          ? 'At least one case came back rate-limited (HTTP 429), so that case ' +
            'proves nothing about schema handling and the run needs repeating.'
          : aisdkCleansDialect
            ? 'The AI SDK performs the Gemini-dialect conversion itself, so ' +
              'cleanGeminiSchema would become redundant.'
            : 'The AI SDK strips a subset of what cleanGeminiSchema strips and ' +
              'leaves others, and the API accepted both wire bodies, so this run ' +
              'does not show the remaining keywords to be incompatible. What it ' +
              'does show is that neither adapter supplies the missing top-level ' +
              'object type that buildGeminiTools patches by hand.'),
    };
  },
};

const RATE_LIMIT_STATUS = 429;
const PAUSE_MS = 4000;

function pause(): Promise<void> {
  return new Promise((done) => setTimeout(done, PAUSE_MS));
}

function isRateLimited(outcome: CaseOutcome | undefined): boolean {
  return outcome?.httpStatus === RATE_LIMIT_STATUS;
}

function describeKeywords(outcome: CaseOutcome): string {
  return outcome.keywordsOnWire.length > 0
    ? outcome.keywordsOnWire.join(', ')
    : 'none';
}

function describeOutcome(outcome: CaseOutcome | undefined): string {
  if (outcome === undefined) {
    return 'not run';
  }
  if (outcome.accepted) {
    return 'accepted';
  }
  return outcome.httpStatus === RATE_LIMIT_STATUS
    ? 'rate-limited (HTTP 429, inconclusive)'
    : `rejected (HTTP ${outcome.httpStatus ?? 'unknown'})`;
}

const QUESTION =
  'For a tool schema full of Gemini-conflicting JSON-Schema keywords, and for ' +
  'an object sub-schema missing `type`, what does each adapter actually put on ' +
  'the wire and does the API accept it?';
