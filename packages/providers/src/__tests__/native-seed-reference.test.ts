/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { formatById, settingsOf } from './support/frozenWire/frozenCases.js';
import { referenceSeedBody } from './support/native-seed-reference.js';
import { sendThroughRoute } from './support/wireBodyCapture.js';
import { PINNED_CLOCK } from './support/wireBodyFixtures.js';

const emptyCall: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'tool_call', id: '', name: 'empty', parameters: {} }],
};
const prefixCall: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'tool_call', id: 'call_', name: 'prefix', parameters: {} }],
};
const realResponse: IContent = {
  speaker: 'tool',
  blocks: [
    {
      type: 'tool_response',
      callId: 'call_',
      toolName: 'prefix',
      result: 'actual response',
    },
  ],
};

const cases: ReadonlyArray<{
  name: string;
  rows: readonly IContent[];
  input: readonly unknown[];
}> = [
  { name: 'unanswered empty id', rows: [emptyCall], input: [] },
  {
    name: 'synthetic prefix response cannot qualify an empty id',
    rows: [emptyCall, prefixCall],
    input: [
      {
        type: 'function_call',
        call_id: 'call_',
        name: 'prefix',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_',
        output: 'Tool execution cancelled by user',
      },
    ],
  },
  {
    name: 'an original normalized response qualifies both aliases',
    rows: [emptyCall, prefixCall, realResponse],
    input: [
      {
        type: 'function_call',
        call_id: 'call_',
        name: 'empty',
        arguments: '{}',
      },
      {
        type: 'function_call',
        call_id: 'call_',
        name: 'prefix',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_',
        output: 'actual response',
      },
    ],
  },
];

describe('independent Responses seed reference pairing boundary', () => {
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(() => setSystemTime());

  for (const id of ['openai-responses-via-openai', 'openai-responses']) {
    const format = formatById(id);
    const settings = settingsOf(format, 179);
    const route = {
      ...format.route,
      model: settings.model,
      providerSettings: {
        ...format.route.providerSettings,
        ...settings.providerSettings,
      },
    };
    for (const sample of cases) {
      it(`${id}: ${sample.name} matches an explicit wire contract`, async () => {
        const expected = JSON.stringify({
          model: settings.model,
          input: sample.input,
          stream: true,
          instructions: settings.systemInstruction,
        });
        expect(referenceSeedBody(format, settings, sample.rows)).toBe(expected);
        const actual = await sendThroughRoute(
          route,
          {
            id: sample.name,
            description: 'literal wire pairing contract',
            rows: sample.rows,
            ephemerals: settings.ephemerals,
            systemInstruction: settings.systemInstruction ?? undefined,
          },
          'stream',
        );
        expect(new TextDecoder().decode(actual.bytes)).toBe(expected);
      });
    }
  }
});
