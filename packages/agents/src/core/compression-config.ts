/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compression configuration constants.
 *
 * Each constant is validated at module load time via {@link validateCompressionConfig}
 * so that an invalid value (NaN, out-of-range fraction, non-positive char limit)
 * cannot silently ship. The validation result is also exported for reuse/tests.
 */

// Threshold for compression token count as a fraction of the model's token limit.
// If the chat history exceeds this threshold, it will be compressed.
// Increased from 0.7 to 0.85 to reduce compression aggressiveness.
export const COMPRESSION_TOKEN_THRESHOLD = 0.85;

// Dynamic preservation threshold calculation: 2 × (1 - compressionThreshold)
// If compression triggers at 85% (0.85), preserve only 30% (2 × 0.15 = 0.3)
// This ensures more aggressive compression when we're closer to limits
export const COMPRESSION_PRESERVE_THRESHOLD =
  2 * (1 - COMPRESSION_TOKEN_THRESHOLD);

// Threshold for preserving the top portion of conversation (original user intent)
export const COMPRESSION_TOP_PRESERVE_THRESHOLD = 0.2;

// Maximum characters to preserve in individual messages for saved sections
export const MAX_MESSAGE_CHARS_IN_PRESERVED = 5000;

/**
 * The shape of the compression configuration values.
 */
export interface CompressionConfig {
  tokenThreshold: number;
  preserveThreshold: number;
  topPreserveThreshold: number;
  maxMessageCharsInPreserved: number;
}

/**
 * Result of validating a {@link CompressionConfig}.
 */
export interface CompressionConfigValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Internal reference to the canonical configuration assembled from the
 * exported constants. Used for the module-load self-check below.
 */
const CANONICAL_CONFIG: CompressionConfig = {
  tokenThreshold: COMPRESSION_TOKEN_THRESHOLD,
  preserveThreshold: COMPRESSION_PRESERVE_THRESHOLD,
  topPreserveThreshold: COMPRESSION_TOP_PRESERVE_THRESHOLD,
  maxMessageCharsInPreserved: MAX_MESSAGE_CHARS_IN_PRESERVED,
};

/**
 * Validates that compression configuration values satisfy their invariants:
 *
 * - Each threshold must be finite and strictly within the open interval (0, 1).
 * - `maxMessageCharsInPreserved` must be a positive integer.
 * - The combined preserved fraction (`topPreserveThreshold + preserveThreshold`)
 *   must remain strictly below `tokenThreshold`, otherwise compression would
 *   never remove enough history to be effective.
 *
 * @returns A {@link CompressionConfigValidationResult} listing all violations
 * (does not fail fast).
 */
export function validateCompressionConfig(
  config: CompressionConfig,
): CompressionConfigValidationResult {
  const errors: string[] = [];

  const {
    tokenThreshold,
    preserveThreshold,
    topPreserveThreshold,
    maxMessageCharsInPreserved,
  } = config;

  const tokenThresholdIsValid = isFiniteFraction(tokenThreshold);
  const preserveThresholdIsValid = isFiniteFraction(preserveThreshold);
  const topPreserveThresholdIsValid = isFiniteFraction(topPreserveThreshold);

  if (!tokenThresholdIsValid) {
    errors.push(
      `tokenThreshold must be finite and in (0, 1); got ${tokenThreshold}`,
    );
  }
  if (!preserveThresholdIsValid) {
    errors.push(
      `preserveThreshold must be finite and in (0, 1); got ${preserveThreshold}`,
    );
  }
  if (!topPreserveThresholdIsValid) {
    errors.push(
      `topPreserveThreshold must be finite and in (0, 1); got ${topPreserveThreshold}`,
    );
  }

  if (
    !Number.isInteger(maxMessageCharsInPreserved) ||
    maxMessageCharsInPreserved <= 0
  ) {
    errors.push(
      `maxMessageCharsInPreserved must be a positive integer; got ${maxMessageCharsInPreserved}`,
    );
  }

  if (
    tokenThresholdIsValid &&
    preserveThresholdIsValid &&
    topPreserveThresholdIsValid &&
    topPreserveThreshold + preserveThreshold >= tokenThreshold
  ) {
    errors.push(
      `combined preserve (top ${topPreserveThreshold} + middle ${preserveThreshold} = ${topPreserveThreshold + preserveThreshold}) must be strictly less than tokenThreshold ${tokenThreshold}`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Returns true when `value` is a finite number strictly inside the open
 * interval (0, 1).
 */
function isFiniteFraction(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value < 1;
}

// Module-load self-check: fail fast if the canonical constants are invalid.
const SELF_CHECK = validateCompressionConfig(CANONICAL_CONFIG);
if (!SELF_CHECK.valid) {
  throw new Error(
    `Invalid compression configuration: ${SELF_CHECK.errors.join('; ')}`,
  );
}
