/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The backoff wait is owned by the session that asked for it (issue #4036):
 * a test, or a late assertion of a test that already timed out, can change
 * only its own session's wait and never the wait of a session running beside
 * it.
 */

import { describe, expect, it } from 'bun:test';
import { installRefusalWaitForTesting, refusalWaitFor } from './refusalWait.js';

function recordingWait(into: number[]) {
  return (ms: number): Promise<void> => {
    into.push(ms);
    return Promise.resolve();
  };
}

describe('refusal backoff wait ownership', () => {
  it('routes each session to the wait installed for it', async () => {
    const first: number[] = [];
    const second: number[] = [];
    const restoreFirst = installRefusalWaitForTesting(
      'session-one',
      recordingWait(first),
    );
    const restoreSecond = installRefusalWaitForTesting(
      'session-two',
      recordingWait(second),
    );

    await refusalWaitFor(() => 'session-one')(15000);
    await refusalWaitFor(() => 'session-two')(60000);
    restoreFirst();
    restoreSecond();

    expect({ first, second }).toStrictEqual({
      first: [15000],
      second: [60000],
    });
  });

  it('keeps another session installed when one restores', async () => {
    const waits: number[] = [];
    const restoreOne = installRefusalWaitForTesting(
      'session-a',
      recordingWait([]),
    );
    const restoreTwo = installRefusalWaitForTesting(
      'session-b',
      recordingWait(waits),
    );

    restoreOne();
    await refusalWaitFor(() => 'session-b')(180000);
    restoreTwo();

    expect(waits).toStrictEqual([180000]);
  });

  it('waits for real, abortably, in a session without an installed wait', async () => {
    const controller = new AbortController();
    const pending = refusalWaitFor(() => 'session-without-seam')(
      120000,
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toBeDefined();
  });

  it('follows the session id as it changes', async () => {
    const waits: number[] = [];
    const restore = installRefusalWaitForTesting(
      'session-after-resume',
      recordingWait(waits),
    );
    let current = 'session-before-resume';
    const wait = refusalWaitFor(() => current);

    current = 'session-after-resume';
    await wait(15000);
    restore();

    expect(waits).toStrictEqual([15000]);
  });
});
