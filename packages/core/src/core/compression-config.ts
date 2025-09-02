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

// The fraction of the latest chat history to keep after compression.
// A value of 0.6 means that 60% of the chat history will be kept.
// Increased from 0.3 to 0.6 to preserve more context during compression.
// This helps prevent over-compression where summaries become too minimal.
export const COMPRESSION_PRESERVE_THRESHOLD = 0.6;
