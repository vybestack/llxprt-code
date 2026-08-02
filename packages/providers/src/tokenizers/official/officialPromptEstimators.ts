/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  RuntimePromptEstimateRequest,
  RuntimePromptEstimateResult,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { RuntimeTokenizer } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizer.js';
import type { PromptEnvelopeProtocol } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import {
  PROJECTION_REVISION,
  type ProviderFinalizedPromptProjection,
} from '../../runtime/promptEnvelopeProjections.js';
import { ModelPromptEstimatorError } from '../ModelPromptEstimatorError.js';
import type { ModelPromptEstimatorRegistration } from '../ModelPromptEstimatorRegistry.js';
import type { AssetManifest } from './assetManifest.js';
import { KimiK3Tokenizer, KIMI_K3_MANIFEST } from './kimiK3Tokenizer.js';
import { GlmTokenizer, GLM_MANIFEST } from './glmTokenizer.js';
import { MinimaxTokenizer, MINIMAX_MANIFEST } from './minimaxTokenizer.js';

/**
 * Counts tokens for one already-projected prompt segment.
 *
 * Segments arriving from the finalized provider projection are model and
 * user content, so they are always encoded as ordinary BPE text. Structural
 * control tokens are never minted from projected text.
 */
interface OfficialSegmentCounter {
  countTokens(content: unknown): number;
}

interface OfficialFamilySpec {
  readonly family: string;
  readonly estimatorVersion: string;
  readonly manifest: AssetManifest;
  readonly claim: RegExp;
  readonly identity: RegExp;
  readonly protocols: ReadonlySet<PromptEnvelopeProtocol>;
  readonly identityErrorHint: string;
  readonly create: () => OfficialSegmentCounter;
}

/**
 * These models are served over OpenAI-compatible chat completions. Any other
 * wire protocol raises an actionable unsupported-protocol error rather than
 * reporting an exact count that would not match the real request body.
 */
const OPENAI_CHAT_ONLY: ReadonlySet<PromptEnvelopeProtocol> =
  new Set<PromptEnvelopeProtocol>(['openai-chat']);

/**
 * GLM 5.2 is additionally served over an Anthropic-compatible endpoint.
 *
 * Claiming both protocols is sound because the finalized projection already
 * captures the protocol-specific request body (anthropic-messages projects
 * system/messages/tools, openai-chat projects messages/tools), while the BPE
 * vocabulary is a property of the model rather than the wire format. Counting
 * whichever text the projection produced is therefore exact either way, and
 * the difference between the two counts is the framing that genuinely differs
 * on the wire.
 */
const OPENAI_CHAT_AND_ANTHROPIC: ReadonlySet<PromptEnvelopeProtocol> =
  new Set<PromptEnvelopeProtocol>(['openai-chat', 'anthropic-messages']);

const OFFICIAL_FAMILY_SPECS: readonly OfficialFamilySpec[] = Object.freeze([
  {
    family: 'moonshot-kimi-k3',
    estimatorVersion: 'kimi-k3-tiktoken-v1',
    manifest: KIMI_K3_MANIFEST,
    claim: /^(?:[a-z0-9_.-]+\/)?kimi-k3(?:$|-)/i,
    identity: /^(?:[a-z0-9_.-]+\/)?kimi-k3(?:-[a-z0-9.-]+)?$/i,
    protocols: OPENAI_CHAT_ONLY,
    identityErrorHint:
      'use a canonical kimi-k3 model id, optionally with a vendor prefix or dated snapshot suffix',
    create: () => new KimiK3Tokenizer(),
  },
  {
    family: 'zai-glm-5.2',
    estimatorVersion: 'glm-5.2-tiktoken-v1',
    manifest: GLM_MANIFEST,
    claim: /^(?:[a-z0-9_.-]+\/)?glm-5\.2(?:$|-)/i,
    identity: /^(?:[a-z0-9_.-]+\/)?glm-5\.2(?:-[a-z0-9.-]+)?$/i,
    protocols: OPENAI_CHAT_AND_ANTHROPIC,
    identityErrorHint:
      'use a canonical glm-5.2 model id, optionally with a vendor prefix or dated snapshot suffix',
    create: () => new GlmTokenizer(),
  },
  {
    family: 'minimax-m3',
    estimatorVersion: 'minimax-m3-tiktoken-v1',
    manifest: MINIMAX_MANIFEST,
    claim: /^(?:[a-z0-9_.-]+\/)?minimax-m3(?:$|-)/i,
    identity: /^(?:[a-z0-9_.-]+\/)?minimax-m3(?:-[a-z0-9.-]+)?$/i,
    protocols: OPENAI_CHAT_ONLY,
    identityErrorHint:
      'use a canonical minimax-m3 model id, optionally with a vendor prefix or dated snapshot suffix',
    create: () => new MinimaxTokenizer(),
  },
]);

/**
 * Provenance string identifying the exact pinned asset behind a count.
 * Mirrors the shape used by the GPT-5.6 estimator.
 */
function assetRevisionOf(manifest: AssetManifest): string {
  return `${manifest.model}:${manifest.sha256}:${manifest.source}@${manifest.revision}`;
}

const counterCache = new Map<string, OfficialSegmentCounter>();

function errorContext(
  request: RuntimePromptEstimateRequest,
  family: string,
): ConstructorParameters<typeof ModelPromptEstimatorError>[1] {
  return {
    activeProvider: request.activeProvider,
    canonicalModel: request.canonicalModel,
    protocol: request.protocol,
    family,
  };
}

function isFinalizedPromptProjection(
  value: unknown,
  protocol: PromptEnvelopeProtocol,
): value is ProviderFinalizedPromptProjection {
  if (typeof value !== 'object' || value === null) return false;
  const projection = value as Partial<ProviderFinalizedPromptProjection>;
  return (
    projection.kind === 'llxprt-provider-prompt-v3' &&
    projection.protocol === protocol &&
    typeof projection.promptText === 'string'
  );
}

function readProjection(
  request: RuntimePromptEstimateRequest,
  spec: OfficialFamilySpec,
): ProviderFinalizedPromptProjection {
  if (
    !isFinalizedPromptProjection(request.finalizedProjection, request.protocol)
  ) {
    throw new ModelPromptEstimatorError(
      'projection-unavailable',
      errorContext(request, spec.family),
      'rebuild the finalized provider projection with the active protocol',
    );
  }
  return request.finalizedProjection;
}

function getCounter(
  request: RuntimePromptEstimateRequest,
  spec: OfficialFamilySpec,
): OfficialSegmentCounter {
  const cached = counterCache.get(spec.family);
  if (cached !== undefined) return cached;
  try {
    const created = spec.create();
    counterCache.set(spec.family, created);
    return created;
  } catch (error) {
    throw new ModelPromptEstimatorError(
      'asset-unavailable',
      errorContext(request, spec.family),
      `verify the pinned ${spec.manifest.model} tokenizer asset is installed and matches its recorded checksum`,
      { cause: error },
    );
  }
}

function countProjection(
  counter: OfficialSegmentCounter,
  projection: ProviderFinalizedPromptProjection,
): number {
  const segments = projection.promptSegments ?? [projection.promptText];
  return segments.reduce(
    (total, segment) => total + counter.countTokens(segment),
    0,
  );
}

async function estimateOfficialPrompt(
  request: RuntimePromptEstimateRequest,
  spec: OfficialFamilySpec,
): Promise<RuntimePromptEstimateResult> {
  const projection = readProjection(request, spec);
  const counter = getCounter(request, spec);
  try {
    return {
      count: countProjection(counter, projection),
      method: 'exact',
      family: spec.family,
      estimatorVersion: spec.estimatorVersion,
      assetRevision: assetRevisionOf(spec.manifest),
      projectionRevision: request.projectionRevision,
    };
  } catch (error) {
    if (error instanceof ModelPromptEstimatorError) throw error;
    throw new ModelPromptEstimatorError(
      'tokenization-failed',
      errorContext(request, spec.family),
      'verify the finalized projection and retry with intact local tokenizer assets',
      { cause: error },
    );
  }
}

function toRegistration(
  spec: OfficialFamilySpec,
): ModelPromptEstimatorRegistration {
  return Object.freeze({
    family: spec.family,
    claim: spec.claim,
    matches: (model: string) => spec.identity.test(model),
    protocols: spec.protocols,
    identityErrorHint: spec.identityErrorHint,
    estimate: (request: RuntimePromptEstimateRequest) =>
      estimateOfficialPrompt(request, spec),
  });
}

export const OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS: readonly ModelPromptEstimatorRegistration[] =
  Object.freeze(OFFICIAL_FAMILY_SPECS.map(toRegistration));

function findSpec(canonicalModel: string): OfficialFamilySpec | undefined {
  return OFFICIAL_FAMILY_SPECS.find((spec) => spec.claim.test(canonicalModel));
}

/**
 * Runtime tokenizer for history accounting on the official-asset models.
 *
 * Declares fallbackPolicy 'deny': once a model is claimed by a pinned
 * official asset, silently degrading to a character estimate would
 * misreport the context budget, so failures surface instead.
 */
export function createOfficialRuntimeTokenizer(
  activeProvider: string,
  canonicalModel: string,
): RuntimeTokenizer | undefined {
  const spec = findSpec(canonicalModel);
  if (spec === undefined) {
    return undefined;
  }
  if (!spec.identity.test(canonicalModel)) {
    return undefined;
  }
  return {
    fallbackPolicy: 'deny',
    async countTokens(content: unknown): Promise<number> {
      const promptText =
        typeof content === 'string' ? content : JSON.stringify(content);
      if (typeof promptText !== 'string') {
        throw new ModelPromptEstimatorError(
          'tokenization-failed',
          {
            activeProvider,
            canonicalModel,
            protocol: 'openai-chat',
            family: spec.family,
          },
          'provide string or JSON-serializable content to the runtime tokenizer',
        );
      }
      const result = await estimateOfficialPrompt(
        {
          activeProvider,
          canonicalModel,
          protocol: 'openai-chat',
          wireMethod: 'chat/completions/v1',
          finalizedProjection: {
            kind: 'llxprt-provider-prompt-v3',
            protocol: 'openai-chat',
            promptText,
          },
          projectionRevision: PROJECTION_REVISION,
          legacyEstimate: () =>
            Promise.reject(new Error('unreachable legacy estimate')),
        },
        spec,
      );
      return result.count;
    },
  };
}

/** Test seam: drop cached tokenizer instances and their WASM encoders. */
export function clearOfficialEstimatorCache(): void {
  counterCache.clear();
}
