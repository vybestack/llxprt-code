/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Waits `ms` milliseconds before a refusal retry. It must reject with an
 * abort error as soon as `signal` aborts, so a cancelled request never sits
 * out the rest of a backoff. Production passes the core `delay`; a unit test
 * of the coordinator can pass any function with this shape.
 */
export type RefusalWait = (ms: number, signal?: AbortSignal) => Promise<void>;
