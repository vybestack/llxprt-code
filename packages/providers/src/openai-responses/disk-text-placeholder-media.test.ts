/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import {
  promptDirs,
  startSourceRouteHarness,
  type SourceRouteHarness,
} from './__tests__/support/source-route-harness.js';

const audio: IContent = {
  speaker: 'human',
  blocks: [
    { type: 'text', text: 'listen' },
    {
      type: 'media',
      mimeType: 'audio/wav',
      encoding: 'base64',
      data: 'UklGRg==',
    },
  ],
};
const pdf: IContent = {
  speaker: 'human',
  blocks: [
    {
      type: 'media',
      mimeType: 'application/pdf',
      encoding: 'base64',
      data: 'JVBERg==',
      filename: 'sample.pdf',
    },
  ],
};

const cases: ReadonlyArray<{
  name: string;
  rows: readonly IContent[];
  ephemerals: Record<string, unknown>;
}> = [
  { name: 'an audio row', rows: [audio], ephemerals: {} },
  {
    name: 'a PDF row with PDF input disabled',
    rows: [pdf],
    ephemerals: { 'media.pdf.enabled': false },
  },
];

describe('Responses source route placeholder-supported media', () => {
  let harness: SourceRouteHarness;
  beforeEach(async () => {
    harness = await startSourceRouteHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  for (const { name, rows, ephemerals } of cases) {
    it(`projects and estimates ${name} like the array route`, async () => {
      const before = promptDirs();
      const baseline = await harness.project(
        harness.arrayOptions(rows, ephemerals),
      );
      const source = await harness.project(harness.options(rows, ephemerals));
      expect(baseline.unsupportedMedia).toHaveLength(1);
      expect(source.unsupportedMedia).toStrictEqual(baseline.unsupportedMedia);
      const factory = harness.setup.factory;
      expect(
        await estimatePromptEnvelope('openai-responses', source, factory),
      ).toStrictEqual(
        await estimatePromptEnvelope('openai-responses', baseline, factory),
      );
      await source.releaseIfUnsent?.();
      await baseline.releaseIfUnsent?.();
      expect(
        [...promptDirs()].filter((entry) => !before.has(entry)),
      ).toHaveLength(0);
    }, 60000);

    it(`sends ${name} as the same text placeholder bytes as the array route`, async () => {
      await harness.sendProjected(harness.arrayOptions(rows, ephemerals));
      await harness.sendProjected(harness.options(rows, ephemerals));
      expect(harness.bodies).toHaveLength(2);
      expect(harness.bodies[1]).toBe(harness.bodies[0]);
    }, 60000);
  }
});
