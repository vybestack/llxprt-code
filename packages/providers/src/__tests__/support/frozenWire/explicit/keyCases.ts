/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: image budget and key-input counterexamples. A stored
 * length is valid for a key; these cases freeze what differs, and what does
 * not, between inputs that look alike.
 */

import { pngOf } from '../../../../anthropic/__tests__/wire-reference/support/wireBuilderCorpus.js';
import type { ProviderToolset } from '../../../../IProvider.js';
import { formatById } from '../frozenCases.js';
import type { ExplicitCase, Observation } from './explicitCase.js';
import { observeForms } from './explicitObserve.js';
import { sendFresh, type ExplicitSend } from './explicitSend.js';
import {
  ai,
  callBlock,
  human,
  imageBlock,
  responseBlock,
  textBlock,
  tool,
} from './rowBuilders.js';

const OFF = ['anthropic-cache-off'];
const NO_REASONING = { 'reasoning.enabled': false };

const TOOLS: ProviderToolset = [
  { name: 'search', parametersJsonSchema: { type: 'object' } },
  { name: 'read_file', parametersJsonSchema: { type: 'object' } },
];

function imageCases(): ExplicitCase[] {
  const rows = [
    human(textBlock('look')),
    ai(callBlock('X')),
    tool(responseBlock('X'), imageBlock(pngOf(4096, 4096))),
    human(textBlock('and now?')),
  ];
  return [
    {
      name: 'images: an AI call without an image and a tool result with one, under a smaller budget',
      review:
        'an AI call with no image of its own and a following tool result with an image, under a smaller image budget',
      observe: () =>
        observeForms(OFF, {
          rows,
          ephemerals: { ...NO_REASONING, 'max-image-dimension': 2000 },
        }),
    },
    {
      name: 'images: the same rows without an image budget',
      review: 'control for the smaller image budget',
      observe: () => observeForms(OFF, { rows, ephemerals: NO_REASONING }),
    },
  ];
}

async function sendsOn(
  label: (key: string) => string,
  keys: readonly string[],
  sendFor: (key: string) => ExplicitSend,
  formatId: string,
): Promise<Observation> {
  const observation: Record<string, Awaited<ReturnType<typeof sendFresh>>> = {};
  for (const key of keys) {
    observation[label(key)] = await sendFresh(
      formatById(formatId),
      sendFor(key),
    );
  }
  return observation;
}

function keyCases(): ExplicitCase[] {
  const thinkingRows = [
    human(textBlock('q')),
    {
      speaker: 'ai' as const,
      blocks: [
        {
          type: 'thinking' as const,
          thought: 'reason',
          sourceField: 'thinking',
          signature: 'sig',
        },
        textBlock('answer'),
      ],
      metadata: { model: 'claude-sonnet-4' },
    },
    human(textBlock('next')),
  ];
  const mediaRows = [
    human(textBlock('look'), imageBlock(pngOf(10, 10)), {
      type: 'media',
      mimeType: 'image/png',
      encoding: 'url',
      data: 'https://example.com/a.png',
    }),
  ];
  return [
    {
      name: 'keys: two models of one class',
      review: 'two models of one class',
      observe: () =>
        sendsOn(
          (model) => model,
          ['claude-sonnet-4', 'claude-sonnet-4-5'],
          (model) => ({
            rows: thinkingRows,
            ephemerals: { 'reasoning.enabled': true },
            model,
          }),
          'anthropic-cache-off',
        ),
    },
    {
      name: 'keys: two endpoints with the same media capabilities',
      review: 'two endpoints with the same media capabilities',
      observe: () =>
        sendsOn(
          (baseURL) => baseURL,
          ['https://api.openai.test/v1', 'https://other.openai.test/v1'],
          (baseURL) => ({ rows: mediaRows, baseURL }),
          'openai-chat-plain',
        ),
    },
    {
      name: 'keys: the OAuth tool-name transform',
      review: 'the OAuth tool-name transform',
      observe: () =>
        sendsOn(
          (token) => (token.startsWith('sk-ant-oat') ? 'oauth' : 'api key'),
          ['sk-ant-oat01-test-token', 'sk-ant-api03-test-key'],
          (authToken) => ({
            rows: [
              human(textBlock('q')),
              ai(callBlock('X', 'search')),
              tool(responseBlock('X')),
              ai(callBlock('Y', 'oauth_search')),
              tool(responseBlock('Y')),
              human(textBlock('next')),
            ],
            tools: TOOLS,
            systemInstruction: 'Be brief.',
            ephemerals: NO_REASONING,
            authToken,
          }),
          'anthropic-cache-off',
        ),
    },
  ];
}

export function keyInputCases(): ExplicitCase[] {
  return [...imageCases(), ...keyCases()];
}
