/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  DensityFileFacts,
  DensityFilePolicy,
} from '../../journal/density-file-facts.js';
import type { IContent } from './IContent.js';

export interface NativeDensityPolicy {
  readonly files?: {
    readonly facts: DensityFilePolicy;
    readonly replace: (
      row: IContent,
      ordinal: number,
      facts: DensityFileFacts,
    ) => Promise<IContent | undefined>;
  };
  readonly factRevision: string;
  readonly retention: number;
  readonly replace: (
    row: IContent,
    selected: (block: number, bucket: string) => Promise<boolean>,
  ) => Promise<IContent | undefined>;
}
