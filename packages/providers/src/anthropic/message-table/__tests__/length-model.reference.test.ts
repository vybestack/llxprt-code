/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the reference machine (the plain-array port of the
 * table builder, validators, finishing pass and cache controls) writes the
 * same JSON as the table route that is in the tree today, and returns the
 * same media purge evidence. This keeps the machine honest until phase 9
 * deletes the table; the frozen corpus carries the expected role after that.
 */

import { describe, expect, it } from 'bun:test';
import {
  formatById,
  caseOf,
} from '../../../__tests__/support/frozenWire/frozenCases.js';
import {
  cachedCandidate,
  type WireSettings,
} from './support/wireBuilderHarness.js';
import { frozenSettingsInputs } from './support/lengthModel/frozenInputs.js';
import { policyOf } from './support/lengthModel/lengthChecks.js';
import {
  referenceRun,
  type CacheOpts,
  type ReferenceRun,
} from './support/lengthModel/referenceFinish.js';
import { OutOfDomain } from './support/lengthModel/referenceTypes.js';
import { unitFacts, type UnitFact } from './support/lengthModel/unitFacts.js';

const SEEDS = 600;

async function differencesOf(formatId: string): Promise<{
  compared: number;
  differences: string[];
}> {
  const format = formatById(formatId);
  const differences: string[] = [];
  let compared = 0;
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const frozen = await caseOf(format, seed);
    const { wire, cache } = frozenSettingsInputs(frozen.settings);
    const units = unitFacts(frozen.rows, wire);
    const reference = tryReference(units, wire, cache);
    if (reference === undefined) continue;
    const table = await cachedCandidate(frozen.rows, wire, cache);
    compared += 1;
    if (table.json !== reference.json) differences.push(`seed ${seed}: JSON`);
    if (table.evidence?.preparation !== reference.evidence) {
      differences.push(`seed ${seed}: purge evidence`);
    }
  }
  return { compared, differences };
}

/** The reference run, or undefined for a history outside the model. */
function tryReference(
  units: UnitFact[],
  wire: WireSettings,
  cache: CacheOpts,
): ReferenceRun | undefined {
  try {
    return referenceRun(units, policyOf(wire), wire, cache);
  } catch (error) {
    if (error instanceof OutOfDomain) return undefined;
    throw error;
  }
}

for (const formatId of ['anthropic-cache-off', 'anthropic-purge-boundary']) {
  describe(`reference machine equals the table: ${formatId}`, () => {
    it(`writes the table's JSON and purge evidence for ${SEEDS} corpus seeds`, async () => {
      const { compared, differences } = await differencesOf(formatId);
      expect(compared).toBeGreaterThan(SEEDS * 0.9);
      expect(differences.slice(0, 10)).toStrictEqual([]);
    });
  });
}
