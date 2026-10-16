/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { JournalStore } from '../../journalStore.js';
import { SeededRandom } from './seededRandom.js';
import { expectStoreMatchesModel } from './storeModelChecks.js';
import { StoreModel, type SavedVersion, type Step } from './storeModel.js';
import { storeDeps } from './storeFixtures.js';

/** Rows the generator aims to keep between these bounds, so the tree reaches three levels now and then. */
const LOW_ROWS = 25;
const HIGH_ROWS = 110;
/** The first steps only grow the history. */
const GROWTH_STEPS = 24;
const SAVED_VERSIONS = 12;

interface Weighted {
  readonly name: string;
  readonly weight: number;
  readonly needsRows: boolean;
}

const OPERATIONS: readonly Weighted[] = [
  { name: 'append', weight: 14, needsRows: false },
  { name: 'pop', weight: 9, needsRows: true },
  { name: 'compress', weight: 6, needsRows: true },
  { name: 'replace', weight: 3, needsRows: false },
  { name: 'density', weight: 8, needsRows: true },
  { name: 'purge', weight: 9, needsRows: true },
  { name: 'insert', weight: 11, needsRows: false },
  { name: 'owner', weight: 10, needsRows: true },
  { name: 'clear', weight: 2, needsRows: false },
  { name: 'restore', weight: 5, needsRows: false },
  { name: 'fill', weight: 8, needsRows: true },
  { name: 'checkpoint', weight: 3, needsRows: false },
  { name: 'combo', weight: 10, needsRows: true },
];

const SHRINKING = new Set(['pop', 'compress', 'density', 'replace']);

function weightOf(op: Weighted, rows: number, saved: number): number {
  if (op.needsRows && rows === 0) return 0;
  if (op.name === 'restore' && saved === 0) return 0;
  if (rows < LOW_ROWS && op.name === 'append') return op.weight * 3;
  if (rows > HIGH_ROWS && SHRINKING.has(op.name)) return op.weight * 3;
  if (rows > HIGH_ROWS && op.name === 'append') return 0;
  return op.weight;
}

function chooseOperation(
  random: SeededRandom,
  rows: number,
  saved: number,
): string {
  const weights = OPERATIONS.map((op) => weightOf(op, rows, saved));
  let roll = random.int(weights.reduce((total, w) => total + w, 0));
  for (const [index, weight] of weights.entries()) {
    if (roll < weight) return OPERATIONS[index].name;
    roll -= weight;
  }
  throw new Error('no operation had weight');
}

function stepFor(
  name: string,
  model: StoreModel,
  saved: readonly SavedVersion[],
  random: SeededRandom,
  index: number,
): Step {
  switch (name) {
    case 'append':
      return model.stepAppend();
    case 'pop':
      return model.stepPop();
    case 'compress':
      return model.stepCompress();
    case 'replace':
      return model.stepReplace();
    case 'density':
      return model.stepDensity();
    case 'purge':
      return model.stepPurge();
    case 'insert':
      return model.stepInsert() ?? model.stepAppend();
    case 'owner':
      return model.stepOwner();
    case 'clear':
      return model.stepClear();
    case 'restore':
      return model.stepRestore(saved[random.int(saved.length)]);
    case 'fill':
      return model.stepFill();
    case 'checkpoint':
      return model.stepCheckpoint(index);
    default:
      return model.stepCombo();
  }
}

export interface SequenceResult {
  /** How many times each step name ran. */
  readonly counts: ReadonlyMap<string, number>;
  readonly checkpoints: number;
}

/**
 * Drives a store with a seeded random sequence of every primitive and, after
 * each step, compares it with the array model. The file is closed and opened
 * again at the end, and the reopened store must match too.
 */
export async function runModelSequence(
  file: string,
  seed: number,
  steps: number,
): Promise<SequenceResult> {
  const random = new SeededRandom(seed);
  const model = new StoreModel(random);
  const store = await JournalStore.create(file, storeDeps());
  const saved: SavedVersion[] = [];
  const counts = new Map<string, number>();
  let checkpoints = 0;
  for (let index = 0; index < steps; index++) {
    const name =
      index < GROWTH_STEPS
        ? 'append'
        : chooseOperation(random, model.rows.length, saved.length);
    const step = stepFor(name, model, saved, random, index);
    await store.commit(step.edits);
    model.endGroup(step);
    if (name === 'checkpoint') checkpoints += 1;
    counts.set(step.name, (counts.get(step.name) ?? 0) + 1);
    try {
      await expectStoreMatchesModel(store, model);
    } catch (error) {
      throw new Error(
        `Seed ${seed}, step ${index} (${step.name}) leaves the store different from the model`,
        { cause: error },
      );
    }
    const version = store.published;
    if (version === undefined) throw new Error('nothing is published');
    saved.push({ version, rows: [...model.rows] });
    if (saved.length > SAVED_VERSIONS) saved.shift();
  }
  await store.close();
  const reopened = await JournalStore.open(file, storeDeps());
  await expectStoreMatchesModel(reopened, model);
  await reopened.close();
  expect(counts.size).toBeGreaterThan(0);
  return { counts, checkpoints };
}
