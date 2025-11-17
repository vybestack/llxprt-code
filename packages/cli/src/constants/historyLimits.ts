/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Default UI history retention limits.
 *
 * The goal is to keep enough scrollback for users to review recent work
 * without letting the in-memory transcript grow without bound.
 */
export const DEFAULT_HISTORY_MAX_ITEMS = 400;
export const DEFAULT_HISTORY_MAX_BYTES = 4 * 1024 * 1024; // 4 MiB
