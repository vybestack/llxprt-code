/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ExactReplayFixture,
  exactRow,
  expectNativeRows,
  expectWireRows,
  fixtureDirectory,
  rowsOf,
} from './__tests__/support/exact-replay-fixture.js';

const switches = fc.sample(
  fc.tuple(
    fc.stringMatching(/^[a-z][a-z0-9_-]{2,12}$/),
    fc.stringMatching(/^[a-z][a-z0-9._-]{2,18}$/),
    fc.array(fc.stringMatching(/^\/[a-z]{1,6}$/), {
      minLength: 1,
      maxLength: 5,
    }),
    fc.array(fc.string({ minLength: 1, maxLength: 10 }), {
      minLength: 1,
      maxLength: 6,
    }),
    fc.array(fc.string({ minLength: 1, maxLength: 10 }), {
      minLength: 1,
      maxLength: 6,
    }),
  ),
  { seed: 8542115, numRuns: 8 },
);
const compressions = fc.sample(
  fc.tuple(
    fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
      minLength: 1,
      maxLength: 8,
    }),
    fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
      minLength: 0,
      maxLength: 8,
    }),
  ),
  { seed: 8542118, numRuns: 8 },
);
const sizes = fc.sample(
  fc.tuple(
    fc.integer({ min: 1, max: 500 }),
    fc.string({ minLength: 1, maxLength: 24 }),
  ),
  { seed: 8542125, numRuns: 8 },
);
const largeTexts = fc.sample(fc.string({ minLength: 1000, maxLength: 5000 }), {
  seed: 8542124,
  numRuns: 6,
});

const backend = 'journal';
describe(`fixed generated public replay on ${backend}`, () => {
  for (const [
    sample,
    [provider, model, directories, first, second],
  ] of switches.entries()) {
    it(`preserves generated metadata and flush segments through two resumes, sample ${sample}`, async () => {
      const fixture = new ExactReplayFixture(
        await fixtureDirectory(`${backend}-segments-${sample}`),
      );
      const firstRows = first.map((text, index) => exactRow(text, index + 1));
      const expected = [
        ...firstRows,
        ...second.map((text, index) =>
          exactRow(text, first.length + index + 1),
        ),
      ];
      await writeFile(
        join(fixture.directory, 'input.json'),
        JSON.stringify({ provider, model, directories, first, second }),
      );
      try {
        await fixture.integration.subscribeToJournal(fixture.history);
        fixture.integration.recordProviderSwitch(provider, model);
        fixture.integration.recordDirectoriesChanged(directories);
        await fixture.history.addBatch(structuredClone(firstRows));
        await fixture.integration.flushAtTurnBoundary();
        const path = fixture.path();
        await fixture.history.addBatch(
          structuredClone(expected.slice(first.length)),
        );
        await fixture.integration.flushAtTurnBoundary();
        expect({ continuedPath: fixture.path() }).toStrictEqual({
          continuedPath: path,
        });
        expectWireRows(await rowsOf(fixture.history), expected);
        await fixture.close();
        for (let round = 0; round < 2; round++) {
          await fixture.resume(
            async (history, integration, _recording, metadata) => {
              expectWireRows(await rowsOf(history), expected);
              expect(metadata.provider).toBe(provider);
              expect(metadata.model).toBe(model);
              expect(metadata.workspaceDirs).toStrictEqual(directories);
              await integration.flushAtTurnBoundary();
              await expectNativeRows(fixture, expected);
            },
            undefined,
            provider,
            model,
          );
        }
      } finally {
        await fixture.close();
      }
    });
  }

  for (const [sample, [before, after]] of compressions.entries()) {
    it(`replaces generated pre-resume membership with summary and post rows, sample ${sample}`, async () => {
      const fixture = new ExactReplayFixture(
        await fixtureDirectory(`${backend}-compression-${sample}`),
      );
      const expected = [
        exactRow('summary', before.length + 1),
        ...after.map((text, index) =>
          exactRow(text, before.length + index + 2),
        ),
      ];
      await writeFile(
        join(fixture.directory, 'input.json'),
        JSON.stringify({ before, after }),
      );
      try {
        await fixture.integration.subscribeToJournal(fixture.history);
        await fixture.history.addBatch(
          before.map((text, index) => exactRow(text, index + 1)),
        );
        await fixture.integration.flushAtTurnBoundary();
        await fixture.close();
        await fixture.resume(async (history, integration) => {
          history.startCompression();
          await history.replaceAll([structuredClone(expected[0])]);
          history.endCompression(structuredClone(expected[0]), before.length);
          await history.addBatch(structuredClone(expected.slice(1)));
          await integration.flushAtTurnBoundary();
          expect(history.getContextRange().totalEntries).toBe(expected.length);
          expectWireRows(await rowsOf(history), expected);
        });
        await fixture.resume(async (history) =>
          expectWireRows(await rowsOf(history), expected),
        );
      } finally {
        await fixture.close();
      }
    });
  }

  for (const [sample, [count, summary]] of sizes.entries()) {
    it(`compresses all ${count} generated rows and continues after resume, sample ${sample}`, async () => {
      const fixture = new ExactReplayFixture(
        await fixtureDirectory(`${backend}-size-${sample}`),
      );
      const expected = [
        exactRow(summary, count + 1),
        exactRow('post-compression-item', count + 2),
      ];
      await writeFile(
        join(fixture.directory, 'input.json'),
        JSON.stringify({ count, summary }),
      );
      try {
        await fixture.integration.subscribeToJournal(fixture.history);
        await fixture.history.addBatch(
          Array.from({ length: count }, (_, index) =>
            exactRow(`baseline-${index}`, index + 1),
          ),
        );
        await fixture.integration.flushAtTurnBoundary();
        expect(fixture.history.getContextRange().totalEntries).toBe(count);
        fixture.history.startCompression();
        await fixture.history.replaceAll([structuredClone(expected[0])]);
        fixture.history.endCompression(structuredClone(expected[0]), count);
        fixture.history.add(structuredClone(expected[1]));
        await fixture.integration.flushAtTurnBoundary();
        await fixture.close();
        await fixture.resume(async (history) => {
          expect(history.getContextRange().totalEntries).toBe(2);
          expectWireRows(await rowsOf(history), expected);
        });
      } finally {
        await fixture.close();
      }
    });
  }

  for (const [sample, text] of largeTexts.entries()) {
    it(`preserves generated minimum-1000-character text byte for byte, sample ${sample}`, async () => {
      const fixture = new ExactReplayFixture(
        await fixtureDirectory(`${backend}-large-${sample}`),
      );
      const expected = [exactRow(text, 1)];
      await writeFile(
        join(fixture.directory, 'input.json'),
        JSON.stringify({ text }),
      );
      try {
        expect(text.length).toBeGreaterThanOrEqual(1000);
        expect(text.length).toBeLessThanOrEqual(5000);
        await fixture.integration.subscribeToJournal(fixture.history);
        fixture.history.add(structuredClone(expected[0]));
        await fixture.integration.flushAtTurnBoundary();
        await fixture.close();
        await fixture.resume(async (history) =>
          expectWireRows(await rowsOf(history), expected),
        );
      } finally {
        await fixture.close();
      }
    });
  }
});
