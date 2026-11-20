/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import type { Observed } from './explicitSend.js';

/** What a named counterexample observes: labelled outputs of today's code. */
export type Observation = Readonly<
  Record<
    string,
    | Observed
    | readonly Observed[]
    | UnitStreamObservation
    | PreparationObservation
  >
>;

/** What the array route's media purge pass returned, and the bytes it wrote. */
export interface PreparationObservation {
  /** `attachMediaPurgeCacheControl`'s evidence: `added`, `reused` or `none`. */
  readonly preparation: 'added' | 'reused' | 'none';
  readonly messagesBytes: number;
}

/** The normalizer's unit stream, as a hash of its sorted-key JSON. */
export interface UnitStreamObservation {
  readonly units: number;
  readonly sha256: string;
  readonly json: string;
}

export interface ExplicitCase {
  /** Unique; becomes the test title and the fixture key. */
  readonly name: string;
  /** The design's wording of the counterexample, for the reader. */
  readonly review: string;
  readonly observe: () => Promise<Observation>;
  /** Extra checks of what the case is about, beyond the frozen bytes. */
  readonly expectation?: (observation: Observation) => void;
}
