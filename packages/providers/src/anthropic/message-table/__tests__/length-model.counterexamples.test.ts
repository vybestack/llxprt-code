/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the named counterexamples against the length model.
 * The expected values are the frozen outputs of today's builders (the
 * counterexample fixtures); each wrong rule the reviews named is run as a
 * control and must be wrong.
 */

import { describe, expect, it } from 'bun:test';
import {
  anthropicScenarios,
  runsOf,
} from '../../../__tests__/support/frozenWire/explicit/anthropicCases.js';
import { readExplicitFixture } from '../../../__tests__/support/frozenWire/explicit/explicitFixture.js';
import {
  PURGE_SCENARIOS,
  type PurgeScenario,
} from '../../../__tests__/support/frozenWire/explicit/purgeBoundaryCases.js';
import { formatById } from '../../../__tests__/support/frozenWire/frozenCases.js';
import { normalizedRows } from '../../../__tests__/support/frozenWire/normalizedRows.js';
import { cacheOf, wireSettingsOf } from './support/lengthModel/frozenInputs.js';
import {
  analyze,
  lcg,
  oldMonoidFields,
} from './support/lengthModel/lengthChecks.js';
import { unitFacts } from './support/lengthModel/unitFacts.js';

const DEFAULT_MODEL = 'claude-opus-5';

interface Recorded {
  readonly length: number;
  readonly member: number;
}

function recordedSends(observation: unknown, label: string): Recorded[] {
  if (typeof observation !== 'object' || observation === null) {
    throw new Error('the fixture holds no observation');
  }
  const sends: unknown = Reflect.get(observation, label);
  if (!Array.isArray(sends)) throw new Error(`no sends under ${label}`);
  return sends;
}

describe('length model against the frozen Anthropic counterexamples', () => {
  const fixture = readExplicitFixture('anthropic');

  for (const scenario of anthropicScenarios()) {
    for (const form of ['raw', 'normalized'] as const) {
      it(`${scenario.name} (${form})`, async () => {
        const format = formatById(scenario.formatId);
        const rows =
          form === 'raw'
            ? scenario.send.rows
            : await normalizedRows(scenario.send.rows);
        const ephemerals = scenario.send.ephemerals ?? {};
        const analysis = analyze(
          rows,
          wireSettingsOf(scenario.send.model ?? format.route.model, ephemerals),
          cacheOf(format.route.providerSettings ?? {}, ephemerals),
          lcg(1),
        );
        const [sent] = recordedSends(
          fixture.cases[scenario.name],
          `${scenario.formatId}/${form}`,
        );
        expect(analysis.predicted).toBe(sent.member);
        expect(analysis.associativity.failures).toBe(0);
      });
    }
  }

  it('control: the old run monoid has equal fields on the twelve-row pair', () => {
    const settings = wireSettingsOf(DEFAULT_MODEL, {});
    const a = oldMonoidFields(
      unitFacts(runsOf([1, 1, 1, 1, 4, 3, 1]), settings),
    );
    const b = oldMonoidFields(
      unitFacts(runsOf([1, 2, 2, 2, 3, 1, 1]), settings),
    );
    expect(a).toStrictEqual(b);
  });

  it('control: the twelve-row pair writes 411 and 461 bytes today', () => {
    const [a, b] = anthropicScenarios().filter((scenario) =>
      scenario.name.startsWith('anthropic ordering: twelve-row pair'),
    );
    const lengths = [a, b].map(
      (scenario) =>
        recordedSends(
          fixture.cases[scenario.name],
          `${scenario.formatId}/raw`,
        )[0].member,
    );
    expect(lengths).toStrictEqual([411, 461]);
  });

  it('control: a model without the repair overlay is wrong on the repair cases', () => {
    const wrong = anthropicScenarios()
      .filter((scenario) => scenario.name.startsWith('anthropic repair'))
      .filter((scenario) => {
        const ephemerals = scenario.send.ephemerals ?? {};
        const analysis = analyze(
          scenario.send.rows,
          wireSettingsOf(DEFAULT_MODEL, ephemerals),
          {},
          lcg(1),
        );
        const [sent] = recordedSends(
          fixture.cases[scenario.name],
          `${scenario.formatId}/raw`,
        );
        return analysis.withoutOverlay !== sent.member;
      });
    expect(wrong.length).toBeGreaterThan(0);
  });

  it('control: the single-unit last-kept substitution is wrong on the thinking chain case', () => {
    const scenario = anthropicScenarios().find((candidate) =>
      candidate.name.endsWith('allButLast, reasoning on'),
    );
    if (scenario === undefined) throw new Error('scenario missing');
    const analysis = analyze(
      scenario.send.rows,
      wireSettingsOf('claude-sonnet-4', scenario.send.ephemerals ?? {}),
      {},
      lcg(1),
    );
    const [sent] = recordedSends(
      fixture.cases[scenario.name],
      `${scenario.formatId}/raw`,
    );
    expect(analysis.predicted).toBe(sent.member);
    expect(analysis.oldSubstitution).not.toBe(sent.member);
  });
});

function purgeName(scenario: PurgeScenario, cache: string): string {
  return `purge boundary: ${scenario.position}, cache ${cache}`;
}

function purgeInputs(scenario: PurgeScenario, cache: 'off' | '5m' | '1h') {
  const ephemerals = {
    'reasoning.enabled': false,
    'media.semantic-purge': 'remove',
  };
  const wire = {
    ...wireSettingsOf(DEFAULT_MODEL, ephemerals),
    isOAuth: scenario.oauthPrefix !== undefined,
  };
  return {
    wire,
    cache: {
      ...cacheOf({ 'prompt-caching': cache }, ephemerals),
      ...(scenario.oauthPrefix === undefined
        ? {}
        : { contextPrefix: scenario.oauthPrefix }),
    },
  };
}

describe('length model against the frozen purge boundary cases', () => {
  const fixture = readExplicitFixture('purge-boundary');

  for (const scenario of PURGE_SCENARIOS) {
    for (const cache of ['off', '5m', '1h'] as const) {
      it(`purge boundary: ${scenario.position}, cache ${cache}`, async () => {
        const recorded: unknown = fixture.cases[purgeName(scenario, cache)];
        const reference = Object(Reflect.get(Object(recorded), 'array route'));
        const { wire, cache: cacheOpts } = purgeInputs(scenario, cache);
        const analysis = analyze(scenario.rows, wire, cacheOpts, lcg(1));
        expect(analysis.predicted).toBe(
          Number(Reflect.get(reference, 'messagesBytes')),
        );
        expect(analysis.evidence ?? 'none').toBe(
          Reflect.get(reference, 'preparation'),
        );
      });
    }
  }

  for (const scenario of PURGE_SCENARIOS.filter(
    (candidate) => candidate.sendThrows === undefined,
  )) {
    it(`purge boundary: ${scenario.position}: the send wrote the predicted bytes`, async () => {
      const normalized = await normalizedRows(scenario.rows);
      for (const cache of ['off', '5m', '1h'] as const) {
        const recorded: unknown = fixture.cases[purgeName(scenario, cache)];
        const { wire, cache: cacheOpts } = purgeInputs(scenario, cache);
        const raw = analyze(scenario.rows, wire, cacheOpts, lcg(1));
        const clean = analyze(normalized, wire, cacheOpts, lcg(1));
        expect(raw.predicted).toBe(recordedSends(recorded, 'raw')[0].member);
        expect(clean.predicted).toBe(
          recordedSends(recorded, 'normalized')[0].member,
        );
      }
    });
  }

  it('control: a model that ignores the breakpoint limit is wrong when all three slots are in use', () => {
    const scenario = PURGE_SCENARIOS.find((candidate) =>
      candidate.position.startsWith('all three breakpoint slots'),
    );
    if (scenario === undefined) throw new Error('scenario missing');
    for (const cache of ['5m', '1h'] as const) {
      const [sent] = recordedSends(
        fixture.cases[purgeName(scenario, cache)],
        'raw',
      );
      const { wire, cache: cacheOpts } = purgeInputs(scenario, cache);
      const correct = analyze(scenario.rows, wire, cacheOpts, lcg(1));
      const ignoring = analyze(
        scenario.rows,
        wire,
        { ...cacheOpts, controlIgnoreBreakpointLimit: true },
        lcg(1),
      );
      expect(correct.predicted).toBe(sent.member);
      expect(ignoring.predicted).not.toBe(sent.member);
    }
  });
});
