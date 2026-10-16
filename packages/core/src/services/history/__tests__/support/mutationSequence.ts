/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  collectJournalRowsForAssertions,
  collectRowsForAssertions,
} from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { SessionRecordingService } from '../../../../recording/SessionRecordingService.js';
import { HistoryService } from '../../HistoryService.js';
import type { ContentBlock, IContent } from '../../IContent.js';

/**
 * Step vocabulary of the frozen mutation-sequence fixture (#854 phase 4, S00).
 * Every step is plain JSON so a fixture file replays without the generator
 * that wrote it. Row contents inside steps are RowSpecs; the replay turns
 * them into IContent.
 */
export interface RowSpec {
  readonly speaker: 'human' | 'ai' | 'tool';
  readonly text?: string;
  readonly call?: { readonly id: string; readonly name: string };
  readonly response?: { readonly callId: string; readonly name: string };
}

export type MutationStep =
  | { readonly op: 'add'; readonly row: RowSpec }
  | { readonly op: 'addAll'; readonly rows: readonly RowSpec[] }
  | { readonly op: 'fill'; readonly count: number; readonly prefix: string }
  | { readonly op: 'pop' }
  | { readonly op: 'removeLast' }
  | { readonly op: 'truncate'; readonly keep: number }
  | { readonly op: 'compress'; readonly summary: RowSpec }
  | {
      readonly op: 'density';
      readonly removals: readonly number[];
      readonly replacements: ReadonlyArray<readonly [number, RowSpec]>;
    }
  | { readonly op: 'densityChanged'; readonly count: number }
  | { readonly op: 'replaceAllNew'; readonly count: number }
  | { readonly op: 'validateAndFix' }
  | { readonly op: 'clear' }
  | { readonly op: 'merge'; readonly rows: readonly RowSpec[] };

/** What one step left behind: the live rows and the rows a resume reads. */
export interface RowsObservation {
  readonly length: number;
  readonly digest: string;
  /** Per-row tags, kept only for short histories so a diff is readable. */
  readonly tags?: readonly string[];
}

export interface StepObservation {
  readonly live: RowsObservation;
  readonly resumed: RowsObservation;
}

export interface FixtureStep {
  readonly step: MutationStep;
  readonly observed: StepObservation;
}

export interface MutationSequenceFixture {
  readonly name: string;
  readonly description: string;
  readonly steps: readonly FixtureStep[];
  /**
   * Present only for a sequence the old fold gets wrong (defect #2). Each
   * entry is the result the design requires after that step, derived from the
   * design and an array model, never from the fold. The new store must match
   * it; the old fold's `observed` stays recorded as what it does today.
   */
  readonly corrected?: readonly StepObservation[];
}

const TAGS_KEPT_UP_TO = 64;
const TAG_HEX_LENGTH = 16;

function blockFacts(block: ContentBlock): unknown {
  switch (block.type) {
    case 'text':
      return ['text', block.text];
    case 'tool_call':
      return ['call', block.id, block.name, block.parameters];
    case 'tool_response':
      return ['response', block.callId, block.toolName, block.result];
    default:
      return [block.type];
  }
}

/**
 * Stable per-row tag: speaker, block facts (text, ids), and chronology.
 * Time stamps and generated metadata ids are left out; they differ per run.
 */
export function tagOf(row: IContent): string {
  const chronology = row.metadata?.chronology;
  const facts = [
    row.speaker,
    row.blocks.map(blockFacts),
    chronology === undefined
      ? null
      : [chronology.seq, chronology.userTurn, chronology.step],
  ];
  return createHash('sha256')
    .update(JSON.stringify(facts))
    .digest('hex')
    .slice(0, TAG_HEX_LENGTH);
}

export function observationOfTags(tags: readonly string[]): RowsObservation {
  const digest = createHash('sha256').update(tags.join('\n')).digest('hex');
  return tags.length <= TAGS_KEPT_UP_TO
    ? { length: tags.length, digest, tags }
    : { length: tags.length, digest };
}

export function observeRows(rows: readonly IContent[]): RowsObservation {
  return observationOfTags(rows.map(tagOf));
}

export function rowFromSpec(spec: RowSpec): IContent {
  const blocks: ContentBlock[] = [];
  if (spec.text !== undefined) blocks.push({ type: 'text', text: spec.text });
  if (spec.call !== undefined)
    blocks.push({
      type: 'tool_call',
      id: spec.call.id,
      name: spec.call.name,
      parameters: {},
    });
  if (spec.response !== undefined)
    blocks.push({
      type: 'tool_response',
      callId: spec.response.callId,
      toolName: spec.response.name,
      result: spec.text ?? '',
    });
  return { speaker: spec.speaker, blocks };
}

function generatedRows(count: number, prefix: string): IContent[] {
  return Array.from({ length: count }, (_, index) =>
    rowFromSpec({
      speaker: index % 2 === 0 ? 'human' : 'ai',
      text: `${prefix}-${index}`,
    }),
  );
}

async function liveRows(history: HistoryService): Promise<RowsObservation> {
  let observed: RowsObservation | undefined;
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    observed = observeRows(rows);
  });
  if (observed === undefined) throw new Error('Live rows were not observed');
  return observed;
}

async function resumedRows(history: HistoryService): Promise<RowsObservation> {
  await history.waitForCommit();
  if (history.journalPath() === null) return observeRows([]);
  let observed: RowsObservation | undefined;
  await collectJournalRowsForAssertions(history, (rows) => {
    observed = observeRows(rows);
  });
  if (observed === undefined) throw new Error('Resumed rows were not read');
  return observed;
}

async function currentRows(history: HistoryService): Promise<IContent[]> {
  let held: IContent[] = [];
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    held = [...rows];
  });
  return held;
}

const NO_DENSITY_METADATA = {
  readWritePairsPruned: 0,
  fileDeduplicationsPruned: 0,
  recencyPruned: 0,
} as const;

async function densityChanged(
  history: HistoryService,
  count: number,
): Promise<void> {
  const replacements = new Map<number, IContent>();
  for (let index = 0; index < count; index += 1)
    replacements.set(
      index,
      rowFromSpec({ speaker: 'human', text: `density-${index}` }),
    );
  await history.applyDensityResult({
    removals: [],
    replacements,
    metadata: NO_DENSITY_METADATA,
  });
}

async function applyStep(
  history: HistoryService,
  step: MutationStep,
): Promise<void> {
  switch (step.op) {
    case 'add':
      history.add(rowFromSpec(step.row));
      return;
    case 'addAll':
      history.addAll(step.rows.map(rowFromSpec));
      return;
    case 'fill':
      history.addAll(generatedRows(step.count, step.prefix));
      return;
    case 'pop':
      await history.pop();
      return;
    case 'removeLast': {
      const rows = await currentRows(history);
      await history.removeLastIfMatches(rows[rows.length - 1]);
      return;
    }
    case 'truncate':
      await history.replaceAll(
        (await currentRows(history)).slice(0, step.keep),
      );
      return;
    case 'compress':
      await history.replaceAll([rowFromSpec(step.summary)]);
      return;
    case 'density':
      await history.applyDensityResult({
        removals: step.removals,
        replacements: new Map(
          step.replacements.map(([index, spec]) => [index, rowFromSpec(spec)]),
        ),
        metadata: NO_DENSITY_METADATA,
      });
      return;
    case 'densityChanged':
      await densityChanged(history, step.count);
      return;
    case 'replaceAllNew':
      await history.replaceAll(generatedRows(step.count, 'replaced'));
      return;
    case 'validateAndFix':
      await history.validateAndFix();
      return;
    case 'clear':
      await history.clear();
      return;
    case 'merge': {
      const other = new HistoryService();
      other.addAll(step.rows.map(rowFromSpec));
      try {
        await history.merge(other);
      } finally {
        await other.dispose();
      }
      return;
    }
    default: {
      const exhaustive: never = step;
      throw new Error(`Unhandled mutation step ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Drive `steps` through a HistoryService recording into a real session
 * journal and observe the live rows and the rows a resume reads after every
 * step. Each step settles all queued work before it is observed.
 */
export async function runMutationSequence(
  steps: readonly MutationStep[],
): Promise<StepObservation[]> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mutation-sequence-'));
  const recording = new SessionRecordingService({
    sessionId: 'mutation-sequence',
    projectHash: 'mutation-sequence',
    chatsDir: path.join(root, 'chats'),
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  const history = new HistoryService({ recording });
  const observed: StepObservation[] = [];
  try {
    for (const step of steps) {
      await applyStep(history, step);
      observed.push({
        live: await liveRows(history),
        resumed: await resumedRows(history),
      });
    }
    return observed;
  } finally {
    await history.dispose();
    await history.waitForOwnershipSettlement();
    await recording.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
}
