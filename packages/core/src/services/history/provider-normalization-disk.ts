/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, rmSync } from 'node:fs';
import { ProviderNormalizationStorage } from './provider-normalization-storage.js';
import { join } from 'node:path';
import { z } from 'zod';
import type { IContent } from './IContent.js';
import { isSpeakerContent } from './historyJournalGuards.js';
import { getScratchRoot } from '../../storage/scratch-root.js';

const pointerSchema = z.object({
  row: z.number().int().nonnegative(),
  block: z.number().int().nonnegative(),
});
export type ProviderBlockPointer = z.infer<typeof pointerSchema>;

export class ProviderNormalizationDisk {
  private readonly directory: string;
  private readonly storage: ProviderNormalizationStorage;
  private semanticBoundaryIdentity: object | undefined;

  constructor(root = getScratchRoot()) {
    this.directory = mkdtempSync(join(root, 'provider-normalization-'));
    try {
      this.storage = new ProviderNormalizationStorage(this.directory);
    } catch (error) {
      rmSync(this.directory, { recursive: true, force: true });
      throw error;
    }
  }

  private read(key: string): unknown {
    try {
      return this.storage.get(key);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return undefined;
      throw error;
    }
  }

  private write(key: string, value: unknown): void {
    this.storage.set(key, value);
  }

  number(key: string): number | undefined {
    const value = this.read(key);
    return value === undefined
      ? undefined
      : z.number().int().nonnegative().parse(value);
  }

  setNumber(key: string, value: number): void {
    this.write(key, value);
  }

  append(stage: string, row: IContent): number {
    const boundary = row.metadata?.semanticMediaPurgeBoundary;
    if (boundary !== undefined) {
      if (
        this.semanticBoundaryIdentity !== undefined &&
        this.semanticBoundaryIdentity !== boundary.boundaryId
      ) {
        throw new Error(
          'Provider request has conflicting semantic purge boundaries',
        );
      }
      this.semanticBoundaryIdentity = boundary.boundaryId;
    }
    const index = this.number(`length:${stage}`) ?? 0;
    this.write(`row:${stage}:${index}`, row);
    this.setNumber(`length:${stage}`, index + 1);
    return index;
  }

  row(stage: string, index: number): IContent {
    const row = this.read(`row:${stage}:${index}`);
    if (!isSpeakerContent(row))
      throw new Error('Missing or invalid provider normalization row');
    const boundary = row.metadata?.semanticMediaPurgeBoundary;
    if (boundary !== undefined) {
      if (this.semanticBoundaryIdentity === undefined)
        throw new Error('Missing semantic purge boundary identity');
      return {
        ...row,
        metadata: {
          ...row.metadata,
          semanticMediaPurgeBoundary: {
            ...boundary,
            boundaryId: this.semanticBoundaryIdentity,
          },
        },
      };
    }
    return row;
  }

  pointer(key: string): ProviderBlockPointer {
    return pointerSchema.parse(this.read(key));
  }

  setPointer(key: string, pointer: ProviderBlockPointer): void {
    this.write(key, pointer);
  }

  close(): void {
    this.semanticBoundaryIdentity = undefined;
    try {
      this.storage.close();
    } finally {
      rmSync(this.directory, { recursive: true, force: true });
    }
  }
}
