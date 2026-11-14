/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { realisticNativeFixture } from '../__tests__/support/realistic-native-fixture.js';
import { responsesLengthRegistration } from './journal-responses-length.js';
import { statefulResponsesSummary } from './native-responses-selection.js';
import * as lengths from './responses-unit-length.js';

const settings: RowFormatSettings = {
  formatId: 'responses',
  formatRev: 1,
  model: 'gpt-5',
  endpoint: 'https://api.openai.com/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: false,
  unsupportedMedia: 'notice',
  outputLimits: null,
};

describe('stateful Responses summary work', () => {
  const directory = useTempDir('stateful-summary-work-');
  it('converts each selected tool unit once when reasoning is absent', async () => {
    const fixture = await realisticNativeFixture(
      directory(),
      { rowCount: 40, payloadBytes: 65536 },
      true,
    );
    try {
      await fixture.selection.native.withFormat(
        responsesLengthRegistration(settings),
        async (snapshot) => {
          const slot = snapshot.version?.slots.formatSlots.findIndex(
            (format) => format.summaryKind === 'responses',
          );
          if (slot === undefined || slot < 0) throw new Error('Missing format');
          const counter = spyOn(lengths, 'responsesUnitLength');
          try {
            const selected = await statefulResponsesSummary(
              fixture.selection.native,
              snapshot,
              slot,
              settings,
              2,
            );
            expect(selected.summary.kind).toBe('responses');
            if (selected.summary.kind !== 'responses')
              throw new Error('Wrong summary');
            expect(selected.summary.variants[0].count[0]).toBe(40);
            expect(selected.summary.variants[0]).toStrictEqual(
              selected.summary.variants[1],
            );
            expect(counter.mock.calls.length).toBe(20);
          } finally {
            counter.mockRestore();
          }
        },
      );
    } finally {
      await fixture.close();
    }
  });
});
