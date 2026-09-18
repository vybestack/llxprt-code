/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const PLACEHOLDER_MODEL = 'placeholder-model';

/**
 * Neutral sentinel provider identity used when no provider is configured.
 * Runtime state factories return this instead of falling back to a hosted
 * provider (e.g. Gemini), so the system boots in an explicitly-unconfigured
 * state that surfaces actionable guidance.
 */
export const UNCONFIGURED_PROVIDER = 'unconfigured';
