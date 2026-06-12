/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compression configuration constants
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
