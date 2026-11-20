/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the named Responses counterexamples against the length
 * model: call ids that normalize to one id, stateful parents and their
 * cursor, a rejected parent, and the PDF aggregate limit. The expected values
 * are the frozen outputs of today's builders (the counterexample fixture);
 * the wrong rules of the reviews are run as controls and must be wrong.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { readExplicitFixture } from '../../__tests__/support/frozenWire/explicit/explicitFixture.js';
import {
  pdfRows,
  rejectedParentRows,
  responsesScenarios,
  type ResponsesScenario,
} from '../../__tests__/support/frozenWire/explicit/responsesCases.js';
import { normalizedRows } from '../../__tests__/support/frozenWire/normalizedRows.js';
import { recordedMembers } from '../../__tests__/support/lengthModel/recorded.js';
import { PINNED_CLOCK } from '../../__tests__/support/wireBodyFixtures.js';
import { PDF_AGGREGATE_MAX_BYTES } from '../../utils/mediaUtils.js';
import {
  FULL_STATELESS_SEND,
  analyzeResponses,
  type SendPlan,
} from './support/lengthModel/responsesLengthModel.js';
import type { ResponsesSettings } from './support/lengthModel/responsesUnitFacts.js';
import {
  CORRECT_RULES,
  statefulPlan,
  type StatefulPlan,
  type StatefulRules,
} from './support/lengthModel/statefulParent.js';

const FORMS = ['raw', 'normalized'] as const;
type Form = (typeof FORMS)[number];

const SETTINGS: ResponsesSettings = {
  includeReasoning: true,
  pdfEnabled: true,
  reasoningIdTime: Date.parse(PINNED_CLOCK),
};

interface ScenarioRun {
  readonly scenario: ResponsesScenario;
  readonly formatId: string;
  readonly form: Form;
}

function runsOf(scenarios: readonly ResponsesScenario[]): ScenarioRun[] {
  return scenarios.flatMap((scenario) =>
    scenario.formatIds.flatMap((formatId) =>
      FORMS.map((form) => ({ scenario, formatId, form })),
    ),
  );
}

function sendPlan(plan: StatefulPlan): SendPlan {
  return {
    cursor: plan.cursor,
    serverSideParent: plan.serverSideParent,
    pairRule: 'normalizedIds',
  };
}

function isStateful(scenario: ResponsesScenario): boolean {
  return scenario.send.ephemerals?.['responses-stateful'] === true;
}

/** The parent id the recorded body sent, if any. */
function sentParent(
  observation: unknown,
  label: string,
  at = 0,
): string | undefined {
  const sends: unknown = Reflect.get(Object(observation), label);
  if (!Array.isArray(sends)) throw new Error(`no sends under ${label}`);
  const body: unknown = Reflect.get(Object(sends[at]), 'body');
  if (typeof body !== 'string') throw new Error(`${label} stored no body`);
  const parent: unknown = Reflect.get(
    Object(JSON.parse(body)),
    'previous_response_id',
  );
  return typeof parent === 'string' ? parent : undefined;
}

async function unitsOf(
  rows: readonly IContent[],
  form: Form,
): Promise<readonly IContent[]> {
  return form === 'raw' ? rows : normalizedRows(rows);
}

interface Predicted {
  readonly bytes: number;
  readonly parentId: string | undefined;
  readonly failures: number;
}

async function predictScenario(
  run: ScenarioRun,
  rules: StatefulRules = CORRECT_RULES,
  pairRule: SendPlan['pairRule'] = 'normalizedIds',
): Promise<Predicted> {
  const rows = run.scenario.send.rows;
  const units = await unitsOf(rows, run.form);
  const plan = isStateful(run.scenario)
    ? statefulPlan(rows, units, new Set(), rules)
    : undefined;
  const analysis = analyzeResponses(
    units,
    SETTINGS,
    plan === undefined
      ? { ...FULL_STATELESS_SEND, pairRule }
      : { ...sendPlan(plan), pairRule },
    1,
  );
  return {
    bytes: analysis.predicted,
    parentId: plan?.parentId,
    failures: analysis.associativity.failures,
  };
}

describe('Responses length model against the frozen Responses counterexamples', () => {
  const fixture = readExplicitFixture('responses');
  const scenarios = responsesScenarios();

  const runs = runsOf(scenarios);

  async function predictedAndRecorded(run: ScenarioRun) {
    const label = `${run.formatId}/${run.form}`;
    const observation = fixture.cases[run.scenario.name];
    const predicted = await predictScenario(run);
    const [recorded] = recordedMembers(observation, label);
    return { predicted, recorded, observation, label };
  }

  for (const run of runs.filter((r) => !isStateful(r.scenario))) {
    it(`${run.scenario.name} (${run.formatId}, ${run.form})`, async () => {
      const { predicted, recorded } = await predictedAndRecorded(run);
      expect(predicted.bytes).toBe(recorded);
      expect(predicted.failures).toBe(0);
    });
  }

  for (const run of runs.filter((r) => isStateful(r.scenario))) {
    it(`${run.scenario.name} (${run.formatId}, ${run.form})`, async () => {
      const { predicted, recorded, observation, label } =
        await predictedAndRecorded(run);
      expect(predicted.bytes).toBe(recorded);
      expect(predicted.failures).toBe(0);
      expect(predicted.parentId).toBe(sentParent(observation, label));
    });
  }

  /** The recorded `input` length of a scenario run, to compare a wrong model with. */
  function recordedOf(run: ScenarioRun): number {
    const [recorded] = recordedMembers(
      fixture.cases[run.scenario.name],
      `${run.formatId}/${run.form}`,
    );
    return recorded;
  }

  async function disagreements(
    pick: (name: string) => boolean,
    rules: StatefulRules,
    pairRule: SendPlan['pairRule'],
  ): Promise<ScenarioRun[]> {
    const wrong: ScenarioRun[] = [];
    for (const run of runsOf(scenarios).filter((r) => pick(r.scenario.name))) {
      const predicted = await predictScenario(run, rules, pairRule);
      if (predicted.bytes !== recordedOf(run)) wrong.push(run);
    }
    return wrong;
  }

  it('control: the design-7.3 shortcut is wrong when call ids "" and "call_" share one normalized id', async () => {
    const wrong = await disagreements(
      (name) => name.startsWith('responses ids:'),
      CORRECT_RULES,
      'designShortcut',
    );
    expect(wrong.length).toBeGreaterThan(0);
  });

  it('control: a cursor placed after the whole row drops the adjacent result', async () => {
    const wrong = await disagreements(
      (name) => name.includes('an adjacent result'),
      { parent: 'newest', cursor: 'afterWholeRow' },
      'normalizedIds',
    );
    expect(wrong.length).toBeGreaterThan(0);
  });

  it('control: an exact-URL parent lookup misses wildcard and trailing-slash parents', async () => {
    const wrong = await disagreements(
      (name) =>
        name.includes('a wildcard endpoint') ||
        name.includes('a trailing-slash endpoint'),
      { parent: 'exactUrl', cursor: 'afterParentUnit' },
      'normalizedIds',
    );
    const names = new Set(wrong.map((run) => run.scenario.name));
    expect(names.size).toBe(2);
  });
});

describe('Responses length model against the frozen rejected-parent case', () => {
  const fixture = readExplicitFixture('responses');
  const observation =
    fixture.cases[
      'responses parent: a rejected parent is not reused by a second source'
    ];
  const rows = rejectedParentRows();
  /** STAND-IN for the state-map rejection entries of the provider instance. */
  const REJECTED = new Set(['resp_dead']);

  function predictInput(
    sent: readonly IContent[],
    rejected: ReadonlySet<string>,
    rules: StatefulRules = CORRECT_RULES,
  ): { bytes: number; parentId: string | undefined } {
    const plan = statefulPlan(sent, sent, rejected, rules);
    return {
      bytes: analyzeResponses(sent, SETTINGS, sendPlan(plan), 1).predicted,
      parentId: plan.parentId,
    };
  }

  it('the first source sends the dead parent, then retries without it', () => {
    const [firstSend, retry] = recordedMembers(observation, 'first source');
    const sent = predictInput(rows.first, new Set());
    expect(sent.bytes).toBe(firstSend);
    expect(sent.parentId).toBe(sentParent(observation, 'first source', 0));
    const retried = predictInput(rows.first, REJECTED);
    expect(retried.bytes).toBe(retry);
    expect(retried.parentId).toBe(sentParent(observation, 'first source', 1));
  });

  it('the second source on the same provider skips the rejected parent', () => {
    const label = 'second source, same provider';
    const [recorded] = recordedMembers(observation, label);
    const predicted = predictInput(rows.second, REJECTED);
    expect(predicted.parentId).toBe('resp_ok');
    expect(predicted.parentId).toBe(sentParent(observation, label));
    expect(predicted.bytes).toBe(recorded);
  });

  it('control: a model with no rejection facts reuses the dead parent', () => {
    const label = 'second source, same provider';
    const [recorded] = recordedMembers(observation, label);
    const predicted = predictInput(rows.second, new Set());
    expect(predicted.parentId).toBe('resp_dead');
    expect(predicted.bytes).not.toBe(recorded);
  });
});

describe('Responses length model against the frozen PDF aggregate cases', () => {
  const fixture = readExplicitFixture('responses');
  const half = Math.floor(PDF_AGGREGATE_MAX_BYTES / 2);

  function pdfAnalysis(secondBytes: number, pdfEnabled: boolean) {
    return analyzeResponses(
      pdfRows(secondBytes),
      { ...SETTINGS, pdfEnabled },
      FULL_STATELESS_SEND,
      1,
    );
  }

  it('two documents just below the limit are sent, with the predicted length', () => {
    const analysis = pdfAnalysis(half - 3, true);
    const [recorded] = recordedMembers(
      fixture.cases[
        'responses pdf: two documents just below the 50,000,000 byte limit are sent'
      ],
      'openai-responses',
    );
    expect(analysis.pdfBytes).toBeLessThanOrEqual(PDF_AGGREGATE_MAX_BYTES);
    expect(analysis.predicted).toBe(recorded);
  });

  it('two documents just above the limit exceed the aggregate, and the send throws', () => {
    const analysis = pdfAnalysis(half + 3, true);
    const observation =
      fixture.cases[
        'responses pdf: two documents just above the 50,000,000 byte limit throw'
      ];
    expect(analysis.pdfBytes).toBeGreaterThan(PDF_AGGREGATE_MAX_BYTES);
    expect(JSON.stringify(observation)).toContain('threw');
  });

  it('the same documents are notices, with no file bytes, when PDF input is disabled', () => {
    const analysis = pdfAnalysis(half + 3, false);
    const [recorded] = recordedMembers(
      fixture.cases[
        'responses pdf: the same oversized documents are sent as notices when PDF input is disabled'
      ],
      'openai-responses',
    );
    expect(analysis.pdfBytes).toBe(0);
    expect(analysis.predicted).toBe(recorded);
  });
});
