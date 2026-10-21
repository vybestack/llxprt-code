/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from './versionSnapshot.js';
import type { RowEntry } from './rowEntry.js';
import type { NativeFactIndexReader } from './nativeFactIndex.js';
import type { NativeFactIndexWriter } from './nativeFactIndex.js';

export const DENSITY_FILES_READY = 'history:density-files:1';
export const DENSITY_FILES_SCOPE = 'density:file-inclusions:1';
export interface DensityFileOccurrence {
  readonly key: string;
  readonly block: number;
  readonly start: number;
}
export interface DensityFilePolicy {
  readonly revision: string;
  readonly occurrences: (
    snapshot: VersionSnapshot,
    entry: RowEntry,
  ) => AsyncIterable<DensityFileOccurrence>;
}
export class DensityFileFacts {
  constructor(readonly reader: NativeFactIndexReader) {}

  async header(): Promise<readonly number[]> {
    return (await this.reader.get(['head'])) ?? [0, 0, 0, 0];
  }
  async latest(key: string): Promise<readonly number[] | undefined> {
    const head = await this.header();
    return this.reader.get([head[0], head[1], 'path', key]);
  }
}
export async function observeDensityFile(
  writer: NativeFactIndexWriter,
  generation: readonly number[],
  occurrence: DensityFileOccurrence,
  ordinal: number,
): Promise<boolean> {
  const key = [generation[0], generation[1], 'path', occurrence.key];
  const old = await writer.get(key);
  const replace =
    old === undefined ||
    ordinal > old[0] ||
    (ordinal === old[0] && occurrence.start > old[2]);
  await writer.set(key, [
    replace ? ordinal : old[0],
    replace ? occurrence.block : old[1],
    replace ? occurrence.start : old[2],
    (old?.[3] ?? 0) + 1,
  ]);
  return old !== undefined;
}
