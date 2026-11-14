/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * The measured window shared by the worker and the tests: a baseline after
 * BASELINE_TURN turns, then CHECKPOINT_COUNT checkpoints,
 * CHECKPOINT_SPACING_TURNS turns apart. Each reading is the median of
 * CENSUS_SAMPLES application-heap censuses taken CENSUS_EVERY_TURNS apart.
 */
export const CHECKPOINT_COUNT = 6;
export const CHECKPOINT_SPACING_TURNS = 50;
export const MEASURED_TURNS = CHECKPOINT_COUNT * CHECKPOINT_SPACING_TURNS;
export const CENSUS_SAMPLES = 3;
export const CENSUS_EVERY_TURNS = 5;
/**
 * Turns before the first baseline census. The census excludes compiled code,
 * so nothing needs to settle first; the warm-up only has to be long enough
 * that the whole run, at about one compression per 10 turns, compresses at
 * least MIN_COMPRESSIONS times (about 45 over 470 turns).
 */
export const WARMUP_TURNS = 160;
export const BASELINE_TURN =
  WARMUP_TURNS + (CENSUS_SAMPLES - 1) * CENSUS_EVERY_TURNS;
/** The release trap lets go of its rows once this many checkpoints are taken. */
export const RELEASE_AFTER_CHECKPOINTS = 3;
/**
 * Compression must happen many times over warm-up plus the measured window,
 * so the proof covers the compress-and-continue path and not only appends.
 */
export const MIN_COMPRESSIONS = 40;
/**
 * Each turn's user message and model reply are about ROW_BYTES of mixed text:
 * that is the payload whose retention the proof must catch. A leaked row per
 * turn grows the heap by about 4 KB per turn and crosses the 1 MiB allowance
 * in about 250 turns.
 */
export const ROW_BYTES = 4_096;
