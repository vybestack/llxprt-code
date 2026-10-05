/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  MetadataJsonProjection,
  type JsonValue,
} from './metadataJsonProjection.js';
import type { DurableDensityIndex } from './durableDensityIndex.js';
import type { ResolverDiskIndex } from './resolverDiskIndex.js';

export const MAX_PURGE_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value
    ? Reflect.get(value, key)
    : undefined;
}
export function validSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function chronology(value: unknown): number {
  const seq = field(field(field(value, 'metadata'), 'chronology'), 'seq');
  return typeof seq === 'number' ? seq : NaN;
}
export function validRow(value: unknown): boolean {
  return (
    ['human', 'ai', 'tool'].includes(String(field(value, 'speaker'))) &&
    typeof field(field(value, 'blocks'), 'count') === 'number'
  );
}
function densityField(keys: ReadonlyArray<string | number>): boolean {
  return (
    keys[0] === 'payload' &&
    (keys[1] === 'removedSeqs' || keys[1] === 'replacements')
  );
}
function rowDepth(keys: ReadonlyArray<string | number>): number {
  if (keys[0] !== 'payload') return -1;
  if (keys[1] === 'content' || keys[1] === 'summary') return 2;
  if (keys[1] === 'history' && typeof keys[2] === 'number') return 3;
  if (
    keys[1] === 'replacements' &&
    typeof keys[2] === 'number' &&
    keys[3] === 'replacement'
  )
    return 4;
  return -1;
}
function retain(
  keys: ReadonlyArray<string | number>,
  metadata: boolean,
  density: boolean,
): boolean {
  if (density && keys[0] === 'payload' && keys.length > 2) {
    if (keys[1] === 'removedSeqs') return false;
    if (keys[1] === 'replacements') {
      if (keys.length === 3) return false;
      if (keys[3] !== 'replacement')
        return keys.length === 4 && keys[3] === 'replacedSeq';
    }
    if (rowDepth(keys) === -1)
      return (
        keys[1] === 'chronology' &&
        keys.length === 3 &&
        ['seq', 'userTurn', 'step', 'recordedAt'].includes(String(keys[2]))
      );
  }
  const depth = rowDepth(keys);
  if (depth !== -1 && keys.length > depth) {
    const tail = keys.slice(depth).join('.');
    return [
      'speaker',
      'blocks',
      'metadata',
      'metadata.chronology',
      'metadata.chronology.seq',
      'metadata.chronology.userTurn',
      'metadata.chronology.step',
      'metadata.chronology.recordedAt',
    ].includes(tail);
  }
  if (keys.length <= 1) return true;
  if (keys[0] !== 'payload') return false;
  if (
    metadata &&
    [
      'sessionId',
      'projectHash',
      'provider',
      'model',
      'startTime',
      'workspaceDirs',
      'cwd',
      'kind',
      'parentSessionId',
      'name',
      'title',
      'checkpointId',
      'parentSequence',
      'checkpointName',
      'directories',
      'severity',
      'message',
    ].includes(String(keys[1]))
  )
    return true;
  return [
    'content',
    'summary',
    'history',
    'frontier',
    'itemsCompressed',
    'itemsRemoved',
    'cutSeq',
    'removedSeqs',
    'replacements',
    'chronologySeq',
    'afterSeq',
    'fromSeq',
    'rowIndex',
    'chronology',
    'invalidateResponses',
    'toSeq',
  ].includes(String(keys[1]));
}

export class ResolverProjection {
  readonly parser: MetadataJsonProjection;
  purgeRows = 0;
  invalidPurge = false;
  private invalidRemoved = false;
  private invalidReplacement = false;
  get invalidDensity(): boolean {
    return this.invalidRemoved || this.invalidReplacement;
  }

  constructor(
    private readonly staged: ResolverDiskIndex,
    private readonly offset: number,
    metadata = false,
    private readonly density?: DurableDensityIndex,
  ) {
    this.parser = new MetadataJsonProjection({
      maxTokenBytes: MAX_PURGE_SNAPSHOT_BYTES,
      retain: (keys) => retain(keys, metadata, density !== undefined),
      scalar: (keys, value) => {
        if (
          density !== undefined &&
          keys[0] === 'payload' &&
          keys.length === 3
        ) {
          if (keys[1] === 'removedSeqs') {
            if (validSeq(value))
              density.add('removed', {
                seq: value,
                start: 0,
                bytes: 0,
                chron: NaN,
              });
            else this.invalidRemoved = true;
            return false;
          }
          if (keys[1] === 'replacements') {
            this.invalidReplacement = true;
            return false;
          }
        }
        const historyElement =
          keys.length === 3 && keys[0] === 'payload' && keys[1] === 'history';
        if (historyElement) this.invalidPurge = true;
        return !historyElement;
      },
      begin: (keys) => {
        const payload = keys.length === 1 && keys[0] === 'payload';
        const history =
          keys.length === 2 && keys[0] === 'payload' && keys[1] === 'history';
        if (payload || history) {
          this.staged.truncate(0);
          this.purgeRows = 0;
          this.invalidPurge = false;
        }
        if (density !== undefined && payload) {
          density.reset();
          this.invalidRemoved = false;
          this.invalidReplacement = false;
        }
        if (density !== undefined && keys[0] === 'payload' && keys.length === 2)
          this.beginDensity(keys[1], density);
      },
      container: (keys, value, start, end, count) =>
        this.container(keys, value, start, end, count),
    });
  }
  private beginDensity(
    key: string | number,
    density: DurableDensityIndex,
  ): void {
    if (key === 'removedSeqs') {
      density.clear('removed');
      this.invalidRemoved = false;
    } else if (key === 'replacements') {
      density.clear('replacement');
      this.invalidReplacement = false;
    }
  }

  private densityContainer(
    keys: ReadonlyArray<string | number>,
    value: JsonValue,
    density: DurableDensityIndex,
  ): JsonValue | undefined {
    if (keys.length === 3 && keys[1] === 'removedSeqs') {
      this.invalidRemoved = true;
      return undefined;
    }
    if (keys.length === 3 && keys[1] === 'replacements') {
      const seq = field(value, 'replacedSeq');
      const row = field(value, 'replacement');
      const start = field(row, 'start');
      const bytes = field(row, 'bytes');
      if (
        !validSeq(seq) ||
        !validRow(row) ||
        typeof start !== 'number' ||
        typeof bytes !== 'number'
      )
        this.invalidReplacement = true;
      else
        density.add('replacement', {
          seq,
          start,
          bytes,
          chron: chronology(row),
        });
      return undefined;
    }
    if (!Array.isArray(value)) {
      if (keys[1] === 'removedSeqs') this.invalidRemoved = true;
      else this.invalidReplacement = true;
      return undefined;
    }
    return [];
  }

  private container(
    keys: ReadonlyArray<string | number>,
    value: JsonValue,
    start: number,
    end: number,
    count: number,
  ): JsonValue | undefined {
    const depth = rowDepth(keys);
    if (depth !== -1 && keys.length === depth + 1 && keys[depth] === 'blocks') {
      if (Array.isArray(value)) return { count };
      if (this.density !== undefined && depth === 4) return null;
    }
    if (this.density !== undefined && densityField(keys) && keys.length < 4)
      return this.densityContainer(keys, value, this.density);
    if (keys.length !== depth) return value;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      if (keys[1] === 'history') {
        this.invalidPurge = true;
        return undefined;
      }
      return value;
    }
    const projected = {
      ...value,
      start: this.offset + start,
      bytes: end - start,
    };
    if (keys[1] !== 'history') return projected;
    const rowIndex = keys[2];
    if (typeof rowIndex !== 'number')
      throw new Error('Invalid purge row index');
    this.purgeRows += 1;
    if (!validRow(projected)) this.invalidPurge = true;
    const blocks = field(field(projected, 'blocks'), 'count');
    this.staged.push({
      seq: 0,
      offset: this.offset,
      length: 0,
      rowIndex,
      start: this.offset + start,
      bytes: end - start,
      chron: chronology(projected),
      userTurn: markerNumber(projected, 'userTurn'),
      step: markerNumber(projected, 'step'),
      recordedAt: markerNumber(projected, 'recordedAt'),
      purge: typeof blocks === 'number' ? blocks : -1,
    });
    return undefined;
  }

  validPurge(frontier: unknown, history: unknown): boolean {
    if (!Array.isArray(history) || this.invalidPurge) return false;
    const contentIndex = field(frontier, 'contentIndex');
    const blockIndex = field(frontier, 'blockIndex');
    if (!validSeq(contentIndex) || !validSeq(blockIndex)) return false;
    if (this.purgeRows === 0)
      return history.length === 0 && contentIndex === 0 && blockIndex === 0;
    if (history.length !== 0 || contentIndex >= this.purgeRows) return false;
    return blockIndex < this.staged.get(contentIndex).purge;
  }
}

function markerNumber(content: unknown, key: string): number | undefined {
  const value = field(field(field(content, 'metadata'), 'chronology'), key);
  return typeof value === 'number' ? value : undefined;
}
