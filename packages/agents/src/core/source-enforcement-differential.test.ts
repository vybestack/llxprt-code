/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { ladderAttempt } from './__tests__/support/source-compression-ladder-fixture.js';

const root = sourceRootSetup();

interface DifferentialCase {
  readonly name: string;
  /** Tail size in 64 KiB chunks; false keeps ordinary rows. */
  readonly tail: number | false;
  readonly limit: number;
  /** Share of rows the high-density strategy keeps; high values make compression ineffective. */
  readonly preserve?: number;
  readonly stages: string[];
  readonly bodies: number;
  readonly errorName: string | undefined;
}

/**
 * Stage lists record the reduction effects both routes drive through the
 * shared handler. Density-only success and tool-response replacement are not
 * reachable with the ordinary-row fixture (density never reduces enough on its
 * own, and it has no tool rows), so those stages are covered by the ladder
 * unit tests; here a ladder that reaches them must still agree end to end.
 */
const cases: DifferentialCase[] = [
  {
    name: 'under the compression threshold performs no stage',
    tail: false,
    limit: 12000,
    stages: [],
    bodies: 1,
    errorName: undefined,
  },
  {
    name: 'configured compression after density optimization',
    tail: false,
    limit: 4000,
    stages: ['density', 'compress'],
    bodies: 1,
    errorName: undefined,
  },
  {
    name: 'hard-limit fallback runs and tool-response truncation replaces nothing before overflow',
    tail: false,
    limit: 3000,
    stages: ['density', 'compress', 'fallback'],
    bodies: 0,
    errorName: 'ContextOverflowError',
  },
  {
    name: 'ineffective compression is retried once before fallback',
    tail: 10,
    limit: 4000,
    preserve: 0.9,
    stages: ['density', 'compress', 'compress', 'fallback'],
    bodies: 0,
    errorName: 'ContextOverflowError',
  },
];

describe('source and array enforcement choose the same stages and request bytes', () => {
  it.each(cases)(
    '$name',
    async (spec) => {
      const array = await ladderAttempt(
        root(),
        false,
        spec.tail,
        spec.limit,
        spec.preserve,
      );
      const source = await ladderAttempt(
        root(),
        true,
        spec.tail,
        spec.limit,
        spec.preserve,
      );
      expect(array.stages).toStrictEqual(spec.stages);
      expect(source.stages).toStrictEqual(array.stages);
      expect(source.bodies).toStrictEqual(array.bodies);
      expect(source.output).toStrictEqual(array.output);
      expect(source.historyTokens).toBe(array.historyTokens);
      expect(source.errorName).toBe(array.errorName);
      expect(source.error).toBe(array.error);
      expect(source.cooldown).toBe(array.cooldown);
      expect(source.estimate).toStrictEqual(array.estimate);
      expect(source.bodies).toHaveLength(spec.bodies);
      expect(source.errorName).toBe(spec.errorName);
      expect(source.activeBodies).toBe(0);
      expect(source.owners.every((owner) => owner.closed)).toBe(true);
    },
    600000,
  );
});
