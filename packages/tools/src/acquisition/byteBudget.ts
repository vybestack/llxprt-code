/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createBrandedByteBudget, type ByteBudget } from './types.js';

/**
 * Default immutable hard ceiling for one acquisition collector.
 *
 * Callers may choose a lower policy ceiling, but acquisition must remain
 * finite regardless of user configuration.
 */
export const ACQUISITION_MIN_BYTES = 1024;
export const ACQUISITION_HARD_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB

/** Default bounded retention used when a caller does not supply a policy. */
export const DEFAULT_ACQUISITION_BUDGET_BYTES = 4 * 1024 * 1024; // 4 MiB

/**
 * Fraction of the budget allocated to the head (beginning) of the output.
 * The remainder goes to the tail (end). A 50/50 split ensures both the
 * command header/context and the final result/error are visible.
 */
export const DEFAULT_HEAD_FRACTION = 0.5;

function normalizeHardMax(hardMax: number): number {
  const requestedCeiling =
    Number.isFinite(hardMax) && hardMax > 0
      ? Math.floor(hardMax)
      : ACQUISITION_HARD_MAX_BYTES;
  return Math.min(
    Math.max(requestedCeiling, ACQUISITION_MIN_BYTES),
    ACQUISITION_HARD_MAX_BYTES,
  );
}

/**
 * Validate and create an immutable {@link ByteBudget}.
 *
 * Rules:
 * - Must be a finite positive number.
 * - Clamped to {@link ACQUISITION_HARD_MAX_BYTES}.
 * - Minimum of {@link ACQUISITION_MIN_BYTES} (below that, head/tail retention
 *   is meaningless).
 * - The `hardMax` ceiling (if supplied) is itself clamped to
 *   {@link ACQUISITION_HARD_MAX_BYTES}, so no caller — even one passing a
 *   custom ceiling — can construct a budget above the absolute cap.
 * - The returned object is {@link Object.freeze}-d so runtime immutability is
 *   truthful, not merely a compile-time `readonly` suggestion.
 *
 * @throws if value is not a finite positive number.
 */
export function createByteBudget(
  bytes: number,
  hardMax: number = ACQUISITION_HARD_MAX_BYTES,
): ByteBudget {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    throw new Error(
      `ByteBudget must be a finite positive number, got: ${String(bytes)}`,
    );
  }

  // A caller-provided ceiling cannot exceed the absolute cap or violate the
  // floor, so every result remains inside the documented finite range.
  const effectiveHardMax = normalizeHardMax(hardMax);

  const clamped = Math.min(
    Math.max(Math.floor(bytes), ACQUISITION_MIN_BYTES),
    effectiveHardMax,
  );

  return Object.freeze(createBrandedByteBudget(clamped));
}

/** Create a default {@link ByteBudget}. */
export function createDefaultByteBudget(): ByteBudget {
  return createByteBudget(DEFAULT_ACQUISITION_BUDGET_BYTES);
}

/**
 * Resolve a raw setting value (from ephemeral settings / profile) into a
 * validated {@link ByteBudget}. Falls back to the default when the value is
 * absent, invalid, or disabled.
 *
 * This function does NOT read settings itself — it receives the raw value
 * and validates it, keeping the acquisition layer free of settings coupling.
 */
export function resolveByteBudgetFromSetting(
  rawValue: unknown,
  hardMax: number = ACQUISITION_HARD_MAX_BYTES,
): ByteBudget {
  const effectiveHardMax = normalizeHardMax(hardMax);
  if (rawValue === undefined || rawValue === null) {
    return createByteBudget(DEFAULT_ACQUISITION_BUDGET_BYTES, effectiveHardMax);
  }

  const numeric = typeof rawValue === 'string' ? Number(rawValue) : rawValue;

  // A configured -1 means "largest permitted value", never unbounded.
  if (numeric === -1) {
    return createByteBudget(effectiveHardMax, effectiveHardMax);
  }

  if (
    typeof numeric !== 'number' ||
    !Number.isFinite(numeric) ||
    numeric <= 0
  ) {
    return createByteBudget(DEFAULT_ACQUISITION_BUDGET_BYTES, effectiveHardMax);
  }

  return createByteBudget(numeric, effectiveHardMax);
}
