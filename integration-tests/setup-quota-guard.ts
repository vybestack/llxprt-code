/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach } from 'bun:test';
import { getQuotaGuardTrip } from './test-helper.js';

/**
 * Per-test short-circuit for the E2E quota guard.
 *
 * Once any real-provider run has hit a quota / rate-limit wall, the guard
 * sentinel is tripped (see `@vybestack/llxprt-code-test-utils`). From that
 * point on, running further tests against the provider is pointless and only
 * burns quota, so this hook stops each remaining test from touching the API.
 *
 * Under Vitest this hook distinguished a fresh attempt (skip, so a quota
 * outage did not turn the run red) from a retry (throw, so an already-recorded
 * failure was not erased). Bun's runner has no equivalent of Vitest's per-test
 * context and therefore no way to skip a test from inside a hook, so both
 * cases now take the throwing path: the API is still never called, and the
 * outage is reported as a failure rather than a skip.
 */
beforeEach(() => {
  const trip = getQuotaGuardTrip();
  if (!trip) {
    return;
  }
  throw new Error(
    `E2E aborted: provider quota/rate-limit exhausted — failing fast without calling the API: ${trip.reason}`,
  );
});
