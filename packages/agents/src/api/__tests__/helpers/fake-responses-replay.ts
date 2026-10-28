/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, beforeEach } from 'bun:test';
import { fileURLToPath } from 'node:url';

/**
 * Points the FakeProvider replay seam (LLXPRT_FAKE_RESPONSES) at a fixture for
 * the whole suite. Property cases open a caller per generated value, and a
 * timed-out property keeps running after its test ends, so per-case set and
 * restore calls would overwrite the value the next test depends on. The
 * returned function switches the fixture for one test; every test starts from
 * the default again.
 */
export function useFakeResponsesReplay(
  defaultFixture: string,
): (fixture: string) => void {
  const fixturePath = (fixture: string): string =>
    fileURLToPath(new URL('../fixtures/' + fixture, import.meta.url));
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.LLXPRT_FAKE_RESPONSES;
  });
  beforeEach(() => {
    process.env.LLXPRT_FAKE_RESPONSES = fixturePath(defaultFixture);
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  });
  return (fixture) => {
    process.env.LLXPRT_FAKE_RESPONSES = fixturePath(fixture);
  };
}
