/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Property-based round-trip tests for the additive neutral Gemini boundary
 * converters (split from neutralConverters.test.ts to respect max-lines).
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-010.2
 */

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { Outcome, Language, type Part } from '@google/genai';
import {
  geminiPartsToBlocks,
  blocksToGeminiParts,
  geminiUsageToUsageStats,
} from './neutralConverters.js';

function roundTrip(part: Part): Part {
  return blocksToGeminiParts(geminiPartsToBlocks([part]))[0];
}

function sortedJson(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(sortedJson).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ':' + sortedJson(value[k]));
  return '{' + pairs.join(',') + '}';
}

function deepEqual(a: unknown, b: unknown): boolean {
  return sortedJson(a) === sortedJson(b);
}

function base64ish(): fc.Arbitrary<string> {
  return fc.stringMatching(/[A-Za-z0-9+/=]{8,64}/);
}

describe('property-based round-trips (REQ-010.2)', () => {
  it('arbitrary text strings survive round-trip', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const part: Part = { text };
        return deepEqual(roundTrip(part), part);
      }),
    );
  });

  it('arbitrary base64ish inlineData survives round-trip', () => {
    fc.assert(
      fc.property(
        base64ish(),
        fc.constantFrom('image/png', 'image/jpeg', 'application/pdf'),
        (data, mimeType) => {
          const part: Part = { inlineData: { mimeType, data } };
          return deepEqual(roundTrip(part), part);
        },
      ),
    );
  });

  it('arbitrary args objects survive functionCall round-trip', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.dictionary(fc.string({ minLength: 1 }), fc.jsonValue()),
        (id, name, args) => {
          const part: Part = { functionCall: { id, name, args } };
          return deepEqual(roundTrip(part), part);
        },
      ),
    );
  });

  it('arbitrary response objects survive functionResponse round-trip', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.dictionary(fc.string({ minLength: 1 }), fc.jsonValue()),
        (id, name, response) => {
          const part: Part = { functionResponse: { id, name, response } };
          return deepEqual(roundTrip(part), part);
        },
      ),
    );
  });

  it('arbitrary code with PYTHON survives executableCode round-trip', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (code) => {
        const part: Part = {
          executableCode: { code, language: Language.PYTHON },
        };
        return deepEqual(roundTrip(part), part);
      }),
    );
  });

  it('arbitrary thought text + signature survives round-trip', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (text, sig) => {
        const part: Part = { thought: true, text, thoughtSignature: sig };
        return deepEqual(roundTrip(part), part);
      }),
    );
  });

  it('arbitrary fileUri with mimeType survives fileData round-trip', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.constantFrom('video/mp4', 'image/png', 'application/pdf'),
        (fileUri, mimeType) => {
          const part: Part = { fileData: { mimeType, fileUri } };
          return deepEqual(roundTrip(part), part);
        },
      ),
    );
  });

  it('arbitrary fileUri without mimeType survives fileData round-trip', () => {
    fc.assert(
      fc.property(fc.webUrl(), (fileUri) => {
        const part: Part = { fileData: { fileUri } };
        return deepEqual(roundTrip(part), part);
      }),
    );
  });

  it('arbitrary output survives codeExecutionResult OUTCOME_OK round-trip', () => {
    fc.assert(
      fc.property(fc.string(), (output) => {
        const part: Part = {
          codeExecutionResult: { outcome: Outcome.OUTCOME_OK, output },
        };
        return deepEqual(roundTrip(part), part);
      }),
    );
  });

  it('arbitrary code with LANGUAGE_UNSPECIFIED survives executableCode round-trip', () => {
    fc.assert(
      fc.property(fc.string(), (code) => {
        const part: Part = {
          executableCode: { code, language: Language.LANGUAGE_UNSPECIFIED },
        };
        return deepEqual(roundTrip(part), part);
      }),
    );
  });

  it('arbitrary functionCall with empty args survives round-trip', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (id, name) => {
          const part: Part = { functionCall: { id, name, args: {} } };
          return deepEqual(roundTrip(part), part);
        },
      ),
    );
  });

  it('arbitrary functionResponse with empty response survives round-trip', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (id, name) => {
          const part: Part = { functionResponse: { id, name, response: {} } };
          return deepEqual(roundTrip(part), part);
        },
      ),
    );
  });

  it('arbitrary codeExecutionResult OUTCOME_FAILED survives round-trip', () => {
    fc.assert(
      fc.property(fc.string(), (output) => {
        const part: Part = {
          codeExecutionResult: { outcome: Outcome.OUTCOME_FAILED, output },
        };
        return deepEqual(roundTrip(part), part);
      }),
    );
  });

  it('arbitrary text part round-trips as a single-element array', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const parts: Part[] = [{ text }];
        const roundTripped = blocksToGeminiParts(geminiPartsToBlocks(parts));
        return deepEqual(roundTripped, parts);
      }),
    );
  });

  it('arbitrary mixed text + functionCall array round-trips', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.dictionary(fc.string({ minLength: 1 }), fc.jsonValue()),
        (text, id, name, args) => {
          const parts: Part[] = [
            { text },
            { functionCall: { id, name, args } },
          ];
          const roundTripped = blocksToGeminiParts(geminiPartsToBlocks(parts));
          return deepEqual(roundTripped, parts);
        },
      ),
    );
  });

  it('arbitrary thought without signature round-trips', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const part: Part = { thought: true, text };
        return deepEqual(roundTrip(part), part);
      }),
    );
  });

  it('arbitrary codeExecutionResult OUTCOME_DEADLINE_EXCEEDED round-trips', () => {
    fc.assert(
      fc.property(fc.string(), (output) => {
        const part: Part = {
          codeExecutionResult: {
            outcome: Outcome.OUTCOME_DEADLINE_EXCEEDED,
            output,
          },
        };
        return deepEqual(roundTrip(part), part);
      }),
    );
  });

  it('arbitrary codeExecutionResult OUTCOME_UNSPECIFIED round-trips', () => {
    fc.assert(
      fc.property(fc.string(), (output) => {
        const part: Part = {
          codeExecutionResult: { outcome: Outcome.OUTCOME_UNSPECIFIED, output },
        };
        return deepEqual(roundTrip(part), part);
      }),
    );
  });

  it('arbitrary text + thought mixed array round-trips', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (text, thought) => {
        const parts: Part[] = [{ text }, { thought: true, text: thought }];
        const roundTripped = blocksToGeminiParts(geminiPartsToBlocks(parts));
        return deepEqual(roundTripped, parts);
      }),
    );
  });

  it('arbitrary executableCode array round-trips', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (code1, code2) => {
        const parts: Part[] = [
          { executableCode: { code: code1, language: Language.PYTHON } },
          { executableCode: { code: code2, language: Language.PYTHON } },
        ];
        const roundTripped = blocksToGeminiParts(geminiPartsToBlocks(parts));
        return deepEqual(roundTripped, parts);
      }),
    );
  });

  it('arbitrary inlineData + text mixed array round-trips', () => {
    fc.assert(
      fc.property(base64ish(), fc.string(), (data, text) => {
        const parts: Part[] = [
          { inlineData: { mimeType: 'image/png', data } },
          { text },
        ];
        const roundTripped = blocksToGeminiParts(geminiPartsToBlocks(parts));
        return deepEqual(roundTripped, parts);
      }),
    );
  });

  it('arbitrary functionCall + functionResponse mixed array round-trips', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (callId, callName, respId, respName) => {
          const parts: Part[] = [
            { functionCall: { id: callId, name: callName, args: {} } },
            { functionResponse: { id: respId, name: respName, response: {} } },
          ];
          const roundTripped = blocksToGeminiParts(geminiPartsToBlocks(parts));
          return deepEqual(roundTripped, parts);
        },
      ),
    );
  });

  it('arbitrary thought with signature array round-trips', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (text, sig) => {
        const parts: Part[] = [{ thought: true, text, thoughtSignature: sig }];
        const roundTripped = blocksToGeminiParts(geminiPartsToBlocks(parts));
        return deepEqual(roundTripped, parts);
      }),
    );
  });

  it('arbitrary fileData without mimeType array round-trips', () => {
    fc.assert(
      fc.property(fc.webUrl(), (fileUri) => {
        const parts: Part[] = [{ fileData: { fileUri } }];
        const roundTripped = blocksToGeminiParts(geminiPartsToBlocks(parts));
        return deepEqual(roundTripped, parts);
      }),
    );
  });

  it('arbitrary codeExecutionResult array round-trips', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (output1, output2) => {
        const parts: Part[] = [
          {
            codeExecutionResult: {
              outcome: Outcome.OUTCOME_OK,
              output: output1,
            },
          },
          {
            codeExecutionResult: {
              outcome: Outcome.OUTCOME_FAILED,
              output: output2,
            },
          },
        ];
        const roundTripped = blocksToGeminiParts(geminiPartsToBlocks(parts));
        return deepEqual(roundTripped, parts);
      }),
    );
  });

  it('arbitrary thought arrays with mixed signature presence round-trip', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.string(),
        (text1, text2, sig) => {
          const parts: Part[] = [
            { thought: true, text: text1 },
            { thought: true, text: text2, thoughtSignature: sig },
          ];
          const roundTripped = blocksToGeminiParts(geminiPartsToBlocks(parts));
          return deepEqual(roundTripped, parts);
        },
      ),
    );
  });
});

describe('property-based — videoMetadata round-trips (REQ-010.2)', () => {
  it('arbitrary inlineData with fps videoMetadata survives round-trip', () => {
    fc.assert(
      fc.property(
        base64ish(),
        fc.float({ min: Math.fround(0.01), max: 24, noNaN: true }),
        (data, fps) => {
          const part: Part = {
            inlineData: { mimeType: 'video/mp4', data },
            videoMetadata: { fps },
          };
          return deepEqual(roundTrip(part), part);
        },
      ),
    );
  });

  it('arbitrary inlineData with full videoMetadata survives round-trip', () => {
    fc.assert(
      fc.property(
        base64ish(),
        fc.float({ min: Math.fround(0.01), max: 24, noNaN: true }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (data, fps, startOffset, endOffset) => {
          const part: Part = {
            inlineData: { mimeType: 'video/mp4', data },
            videoMetadata: { fps, startOffset, endOffset },
          };
          return deepEqual(roundTrip(part), part);
        },
      ),
    );
  });

  it('arbitrary fileData with videoMetadata survives round-trip', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.float({ min: Math.fround(0.01), max: 24, noNaN: true }),
        (fileUri, fps) => {
          const part: Part = {
            fileData: { mimeType: 'video/mp4', fileUri },
            videoMetadata: { fps },
          };
          return deepEqual(roundTrip(part), part);
        },
      ),
    );
  });
});

describe('property-based — usage metadata mapping (REQ-010.3)', () => {
  it('arbitrary usage numbers map correctly to UsageStats', () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.nat(),
        fc.nat(),
        (promptTokenCount, candidatesTokenCount, totalTokenCount) => {
          const result = geminiUsageToUsageStats({
            promptTokenCount,
            candidatesTokenCount,
            totalTokenCount,
          });
          return (
            result.promptTokens === promptTokenCount &&
            result.completionTokens === candidatesTokenCount &&
            result.totalTokens === totalTokenCount
          );
        },
      ),
    );
  });

  it('arbitrary optional usage fields map correctly when present', () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        (
          promptTokenCount,
          candidatesTokenCount,
          totalTokenCount,
          cachedContentTokenCount,
          thoughtsTokenCount,
          toolUsePromptTokenCount,
        ) => {
          const result = geminiUsageToUsageStats({
            promptTokenCount,
            candidatesTokenCount,
            totalTokenCount,
            cachedContentTokenCount,
            thoughtsTokenCount,
            toolUsePromptTokenCount,
          });
          return (
            result.cachedTokens === cachedContentTokenCount &&
            result.reasoningTokens === thoughtsTokenCount &&
            result.toolTokens === toolUsePromptTokenCount
          );
        },
      ),
    );
  });

  it('arbitrary usage omits optional fields when undefined', () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), fc.nat(), (p, c, t) => {
        const result = geminiUsageToUsageStats({
          promptTokenCount: p,
          candidatesTokenCount: c,
          totalTokenCount: t,
        });
        return (
          result.cachedTokens === undefined &&
          result.reasoningTokens === undefined &&
          result.toolTokens === undefined
        );
      }),
    );
  });

  it('arbitrary usage with only cachedContentTokenCount maps correctly', () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), fc.nat(), fc.nat(), (p, c, t, cached) => {
        const result = geminiUsageToUsageStats({
          promptTokenCount: p,
          candidatesTokenCount: c,
          totalTokenCount: t,
          cachedContentTokenCount: cached,
        });
        return (
          result.cachedTokens === cached &&
          result.reasoningTokens === undefined &&
          result.toolTokens === undefined
        );
      }),
    );
  });

  it('arbitrary usage with only thoughtsTokenCount maps correctly', () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        (p, c, t, thoughts) => {
          const result = geminiUsageToUsageStats({
            promptTokenCount: p,
            candidatesTokenCount: c,
            totalTokenCount: t,
            thoughtsTokenCount: thoughts,
          });
          return (
            result.reasoningTokens === thoughts &&
            result.cachedTokens === undefined &&
            result.toolTokens === undefined
          );
        },
      ),
    );
  });
});
