/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3481 regression: a tool turn whose result is a resized image must
 * estimate the image cost through the settled patch formula (not as raw
 * text), and a stateful incremental turn must not re-count the instructions
 * and tools the server-side parent already retains (observed provider usage
 * does not re-bill them; counting them again double-counted the observed
 * parent baseline).
 *
 * The pipeline runs end to end: processSingleFileContent on a real PNG file,
 * convertToFunctionResponse into tool blocks, buildOpenAIResponsesInput into
 * the wire input, projectOpenAIResponsesPromptEnvelope into the finalized
 * projection, and estimateGpt56Prompt over it.
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { convertToFunctionResponse } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { processSingleFileContent } from '@vybestack/llxprt-code-tools/utils/fileUtils.js';
import {
  buildOpenAIResponsesInput,
  type ResponsesInputBuildContext,
} from '../openai-responses/OpenAIResponsesInputBuilder.js';
import { projectOpenAIResponsesPromptEnvelope } from '../runtime/promptEnvelopeProjections.js';
import { estimateGpt56Prompt } from './Gpt56O200kPromptEstimator.js';

/**
 * Minimal PNG whose IHDR declares 1586x991: 8-byte signature, IHDR chunk
 * (length 13, 'IHDR', width/height big-endian, bit depth 8, color type 6,
 * three zero bytes, zeroed CRC). No IDAT is needed: only the header is
 * read by both the dimension parser and the provider's patch formula.
 */
function handcraftedPngBytes(width: number, height: number): Buffer {
  const bytes = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
  return Buffer.from(bytes);
}

const PNG_WIDTH = 1586;
const PNG_HEIGHT = 991;
/** 1586x991 on codex/gpt-5.6: ceil(1.2 * min(ceil(1586/32)*ceil(991/32), 1536)) = 1844. */
const IMAGE_TOKEN_COST = 1844;

const buildContext = (): ResponsesInputBuildContext => ({
  includeReasoningInContext: true,
  outputLimiterConfig: { getEphemeralSettings: () => ({}) },
  debug: () => {},
  mediaPdfEnabled: true,
});

let tempDir: string;
let processed: Awaited<ReturnType<typeof processSingleFileContent>>;

function toolBlocksForCall(callId: string) {
  return convertToFunctionResponse('read_file', callId, processed.llmContent);
}

function imageTurnHistory(encryptedContent: string): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Look at the screenshot' }],
    },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'I should inspect the screenshot',
          encryptedContent,
        },
        { type: 'text', text: 'Let me read the file.' },
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'read_file',
          parameters: { path: 'screenshot.png' },
        },
      ],
    },
    { speaker: 'tool', blocks: toolBlocksForCall('call_1') },
  ];
}

/**
 * Baseline: same reasoning item and equivalent plain-text assistant turn,
 * but no tool turn (no image). The count delta against the image turn is
 * therefore the image cost plus a small, bounded scaffold difference.
 */
function baselineHistory(encryptedContent: string): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Look at the screenshot' }],
    },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'I should inspect the screenshot',
          encryptedContent,
        },
        {
          type: 'text',
          text: 'Here is the screenshot description: a dashboard view.',
        },
      ],
    },
  ];
}

async function countHistory(history: IContent[]): Promise<{
  count: number;
  projection: ReturnType<typeof projectOpenAIResponsesPromptEnvelope>;
}> {
  const input = buildOpenAIResponsesInput(history, buildContext());
  const requestBody = { model: 'gpt-5.6-sol', input };
  const projection = projectOpenAIResponsesPromptEnvelope(requestBody);
  const result = await estimateGpt56Prompt({
    activeProvider: 'codex-alias',
    canonicalModel: 'gpt-5.6-sol',
    protocol: 'openai-responses',
    wireMethod: 'responses/v1',
    finalizedProjection: projection.finalizedProjection,
    projectionRevision: projection.projectionRevision,
    legacyEstimate: projection.legacyEstimate,
  });
  return { count: result.count, projection };
}

describe('issue #3481: image tool turn + encrypted reasoning (real pipeline)', () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'llxprt-issue3481-'));
    const pngPath = path.join(tempDir, 'screenshot.png');
    await writeFile(pngPath, handcraftedPngBytes(PNG_WIDTH, PNG_HEIGHT));
    processed = await processSingleFileContent(
      pngPath,
      tempDir,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('projects the image turn with a 1586x991 image entry', async () => {
    const { projection } = await countHistory(
      imageTurnHistory('A'.repeat(40_000)),
    );
    const finalized = projection.finalizedProjection as {
      imageEntries?: ReadonlyArray<{
        dimensions?: { width: number; height: number };
      }>;
    };
    expect(finalized.imageEntries).toStrictEqual([
      { dimensions: { width: PNG_WIDTH, height: PNG_HEIGHT } },
    ]);
  });

  it('charges the image cost, not the blob, for the image turn delta', async () => {
    const image = await countHistory(imageTurnHistory('A'.repeat(40_000)));
    const baseline = await countHistory(baselineHistory('A'.repeat(40_000)));
    const delta = image.count - baseline.count;
    // The delta must be the settled image cost plus a small scaffold
    // difference, not the thousands of tokens a raw blob would add.
    expect(delta).toBeGreaterThanOrEqual(IMAGE_TOKEN_COST + 80);
    expect(delta).toBeLessThanOrEqual(IMAGE_TOKEN_COST + 400);
  });
});

describe('issue #3481: stateful incremental excludes retained instructions/tools', () => {
  const INSTRUCTIONS_MARKER =
    'MARKER-INSTRUCTIONS-DO-NOT-COUNT-AGAIN-unique-string';
  const TOOLS_MARKER = 'MARKER-TOOLS-SCHEMA-DO-NOT-COUNT-AGAIN-unique-string';

  const retainedBaselineTokens = 9_689;

  function statefulProjectionFor(history: IContent[]) {
    const input = buildOpenAIResponsesInput(history, buildContext());
    const body = {
      model: 'gpt-5.6-sol',
      instructions: INSTRUCTIONS_MARKER,
      input,
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: TOOLS_MARKER,
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
      ],
    };
    return projectOpenAIResponsesPromptEnvelope(body, undefined, {
      statefulParentUsed: true,
      incrementalRequest: body,
      retainedBaselineTokens,
    });
  }

  async function countIncremental(
    projection: ReturnType<typeof statefulProjectionFor>,
  ) {
    const incremental = projection.accounting?.incremental;
    if (incremental === undefined) {
      throw new Error('stateful projection without an incremental projection');
    }
    const result = await estimateGpt56Prompt({
      activeProvider: 'codex-alias',
      canonicalModel: 'gpt-5.6-sol',
      protocol: 'openai-responses',
      wireMethod: 'responses/v1',
      finalizedProjection: incremental.finalizedProjection,
      projectionRevision: projection.projectionRevision,
      legacyEstimate: incremental.legacyEstimate,
    });
    return result.count;
  }

  it('estimates retained baseline + input-only count for a stateful turn (issue #3481)', async () => {
    const projection = statefulProjectionFor(
      imageTurnHistory('A'.repeat(40_000)),
    );
    const incremental = projection.accounting?.incremental;
    const finalized = incremental?.finalizedProjection as
      | {
          promptText: string;
          imageEntries?: ReadonlyArray<{
            dimensions?: { width: number; height: number };
          }>;
        }
      | undefined;
    expect(finalized).toBeDefined();
    // The observed parent baseline already includes the re-sent instructions
    // and tools, so the incremental estimate must not count them again.
    expect(finalized?.promptText).not.toContain(INSTRUCTIONS_MARKER);
    expect(finalized?.promptText).not.toContain(TOOLS_MARKER);
    // ...but it still carries the image entry with parsed dimensions.
    expect(finalized?.imageEntries).toStrictEqual([
      { dimensions: { width: PNG_WIDTH, height: PNG_HEIGHT } },
    ]);

    const textOnlyCount = await countIncremental(
      statefulProjectionFor(baselineHistory('A'.repeat(40_000))),
    );
    const imageCount = await countIncremental(projection);
    // The image part costs its settled patch-formula tokens on top of the
    // text-only input count, plus the small tool-block scaffold difference.
    const delta = imageCount - textOnlyCount;
    expect(delta).toBeGreaterThanOrEqual(IMAGE_TOKEN_COST + 80);
    expect(delta).toBeLessThanOrEqual(IMAGE_TOKEN_COST + 400);
  });
});
