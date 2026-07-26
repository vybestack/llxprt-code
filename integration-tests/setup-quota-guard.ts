/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach } from 'vitest';
import { getQuotaGuardTrip } from './test-helper.js';

/**
 * Per-test short-circuit for the E2E quota guard.
 *
 * Once any real-provider run has hit a quota / rate-limit wall, the guard
 * sentinel is tripped (see `@vybestack/llxprt-code-test-utils`). From that
 * point on, running further tests against the provider is pointless and only
 * burns quota, so this hook stops each remaining test from touching the API.
 *
 * CRITICAL semantics (verified against vitest 3.2 — do not change):
 *  - On a FRESH test (retryCount === 0), `ctx.skip(note)` throws a skip signal
 *    BEFORE the test file's own `beforeEach`/test body run, so no API call is
 *    made and the test is reported as skipped with the quota note.
 *  - On a RETRY of an already-failed test (retryCount > 0), skipping would
 *    ERASE the original failure and let the whole run exit 0 — masking the
 *    quota outage as success. Retries must therefore THROW instead, which
 *    fails fast (no API call) while preserving a non-zero outcome.
 */
beforeEach((ctx) => {
  const trip = getQuotaGuardTrip();
  if (!trip) {
    return;
  }

  const retryCount = ctx.task.result?.retryCount ?? 0;
  if (retryCount === 0) {
    ctx.skip(
      `E2E aborted: provider quota/rate-limit exhausted — ${trip.reason}`,
    );
  } else {
    throw new Error(
      `E2E aborted: provider quota/rate-limit exhausted — failing retry fast without calling the API: ${trip.reason}`,
    );
  }
});
