/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the unit stream core normalization emits, as a function
 * of per-id facts (design section 6). The model is checked against the unit
 * streams the normalizer counterexample fixture recorded and, as a
 * differential, against core normalization on random histories. The two
 * readings of the design that the reviews found wrong are run as controls.
 */

import { describe, expect, it } from 'bun:test';
import { readExplicitFixture } from './support/frozenWire/explicit/explicitFixture.js';
import { normalizerScenarios } from './support/frozenWire/explicit/normalizerCases.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';
import { emissionHistory } from './support/lengthModel/emissionHistories.js';
import {
  CORE_RULES,
  emittedUnits,
  unitKeyOf,
  type EmissionRules,
  type UnitKey,
} from './support/lengthModel/unitStreamEmission.js';

const HISTORIES = 2000;

function recordedUnitKeys(observation: unknown): UnitKey[] {
  const units: unknown = Reflect.get(Object(observation), 'units');
  const json: unknown = Reflect.get(Object(units), 'json');
  if (typeof json !== 'string') throw new Error('the fixture holds no units');
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('the recorded units are no list');
  return parsed.map((unit) => unitKeyOf(unit));
}

describe('unit stream emission against the frozen normalizer counterexamples', () => {
  const fixture = readExplicitFixture('normalizer');

  for (const scenario of normalizerScenarios()) {
    it(`${scenario.name}`, () => {
      const recorded = recordedUnitKeys(fixture.cases[scenario.name]);
      expect(emittedUnits(scenario.rows, CORE_RULES)).toStrictEqual(recorded);
    });
  }

  it('control: units for AI parts only drop the result of a call in a human row', () => {
    const rules: EmissionRules = { ...CORE_RULES, adjacentUnit: 'aiPartsOnly' };
    const wrong = normalizerScenarios().filter((scenario) => {
      const recorded = recordedUnitKeys(fixture.cases[scenario.name]);
      return (
        JSON.stringify(emittedUnits(scenario.rows, rules)) !==
        JSON.stringify(recorded)
      );
    });
    expect(wrong.length).toBeGreaterThan(0);
  });
});

describe('unit stream emission against core normalization on random histories', () => {
  const differences = new Map<string, number>([
    ['core rules', 0],
    ['units for AI parts only', 0],
    ['orphan owned by the first call of any speaker', 0],
  ]);
  const variants: Array<[string, EmissionRules]> = [
    ['core rules', CORE_RULES],
    ['units for AI parts only', { ...CORE_RULES, adjacentUnit: 'aiPartsOnly' }],
    [
      'orphan owned by the first call of any speaker',
      { ...CORE_RULES, orphanOwner: 'firstCall' },
    ],
  ];
  const examples: string[] = [];
  let callInNonAiRow = 0;

  it(`the model emits the units core emits on ${HISTORIES} histories`, async () => {
    for (let seed = 1; seed <= HISTORIES; seed += 1) {
      const rows = emissionHistory(seed);
      const real = (await normalizedRows(rows)).map((unit) => unitKeyOf(unit));
      if (
        rows.some(
          (row) =>
            row.speaker !== 'ai' &&
            row.blocks.some((b) => b.type === 'tool_call'),
        )
      ) {
        callInNonAiRow += 1;
      }
      for (const [name, rules] of variants) {
        if (JSON.stringify(emittedUnits(rows, rules)) === JSON.stringify(real))
          continue;
        differences.set(name, (differences.get(name) ?? 0) + 1);
        if (name === 'core rules' && examples.length < 5)
          examples.push(`seed ${seed}`);
      }
    }
    expect(examples).toStrictEqual([]);
    expect(differences.get('core rules')).toBe(0);
    expect(callInNonAiRow).toBeGreaterThan(HISTORIES / 4);
  });

  it('control: the AI-parts-only reading of design R4 is wrong on the histories', () => {
    expect(differences.get('units for AI parts only')).toBeGreaterThan(0);
  });

  it('control: the first-call-of-any-speaker reading of design R3 is wrong on the histories', () => {
    expect(
      differences.get('orphan owned by the first call of any speaker'),
    ).toBeGreaterThan(0);
  });
});
