/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectBackend } from '../historyBackend.js';
import {
  runMutationSequence,
  type MutationSequenceFixture,
  type StepObservation,
} from './support/mutationSequence.js';

/**
 * Replays the frozen mutation sequences (#854 phase 4, S00) through
 * HistoryService and compares the live rows and the rows a resume reads after
 * every step. The JSON files were generated once from the old fold and are
 * never regenerated; the new store has to reproduce them.
 *
 * The one exception is known-defect-2: the old fold cuts a pop at the first
 * row that repeats a chronology marker (design 13.5 defect 2), so its recorded
 * result is wrong on purpose. On the old backend the test pins that wrong
 * result; on the journal backend it requires the corrected one, which the
 * fixture derives from the design with an array model.
 */
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'mutation-sequence',
);

function loadFixtures(): MutationSequenceFixture[] {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map(
      (file) =>
        JSON.parse(
          fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'),
        ) as MutationSequenceFixture,
    );
}

function expectedFor(fixture: MutationSequenceFixture): StepObservation[] {
  const journalBackend = selectBackend() === 'journal';
  if (journalBackend && fixture.corrected !== undefined)
    return [...fixture.corrected];
  return fixture.steps.map((entry) => entry.observed);
}

describe('frozen mutation sequences', () => {
  const fixtures = loadFixtures();

  it('ships the fixture files this slice generated', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(19);
    expect(fixtures.filter((f) => f.corrected !== undefined)).toHaveLength(1);
  });

  for (const fixture of fixtures) {
    it(`${fixture.name}: ${fixture.description}`, async () => {
      const actual = await runMutationSequence(
        fixture.steps.map((entry) => entry.step),
      );
      const expected = expectedFor(fixture);
      expect(actual).toHaveLength(expected.length);
      actual.forEach((observation, index) => {
        expect({ step: index, ...observation }).toStrictEqual({
          step: index,
          ...expected[index],
        });
      });
    }, 180_000);
  }

  it('records live and resumed rows as equal after every step of every fixture except the defect case', () => {
    for (const fixture of fixtures) {
      if (fixture.corrected !== undefined) continue;
      fixture.steps.forEach((entry, index) => {
        expect({
          fixture: fixture.name,
          step: index,
          resumed: entry.observed.resumed,
        }).toStrictEqual({
          fixture: fixture.name,
          step: index,
          resumed: entry.observed.live,
        });
      });
    }
  });
});
