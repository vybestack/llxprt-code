/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';

export interface NativeDensityPolicy {
  readonly factRevision: string;
  readonly retention: number;
  readonly replace: (
    row: IContent,
    selected: (block: number, bucket: string) => Promise<boolean>,
  ) => Promise<IContent | undefined>;
}
