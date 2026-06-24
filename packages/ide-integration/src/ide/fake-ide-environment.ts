/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-014
 *
 * Shipped fake IDE environment seam — the IDE analogue of FakeProvider.
 *
 * When the environment variable `LLXPRT_FAKE_IDE` points at a JSON fixture
 * file, the public Agent IDE control reads detected/current/trust state from
 * the fixture instead of probing the real process environment (TERM_PROGRAM,
 * process tree, IDE companion connection). This is a legitimate, shipped test
 * double: production code never imports from any `__tests__` directory.
 *
 * The fixture is a SHARED, mutable JSON file. Because the public `ide.trust()`
 * call and the test's own fake-environment mirror both write the SAME file,
 * trusting through the public surface and observing it through the public
 * surface stays consistent — the control logic runs for real.
 */

import { readFileSync, writeFileSync } from 'node:fs';

/** A detected IDE in the fake environment fixture. */
export interface FakeIdeFixtureEntry {
  readonly name: string;
  readonly version?: string;
  readonly trusted?: boolean;
}

/** The full on-disk fake IDE fixture shape. */
export interface FakeIdeFixture {
  /** Name of the IDE considered "current"; null/absent when none is active. */
  readonly currentName?: string | null;
  readonly detected: readonly FakeIdeFixtureEntry[];
}

const FAKE_IDE_ENV = 'LLXPRT_FAKE_IDE';

/**
 * True when the fake IDE environment seam is active (the `LLXPRT_FAKE_IDE`
 * environment variable points at a fixture file).
 */
export function isFakeIdeActive(): boolean {
  const value = process.env[FAKE_IDE_ENV];
  return typeof value === 'string' && value.length > 0;
}

/** Resolves the fake IDE fixture path, or undefined when the seam is inactive. */
export function fakeIdeFixturePath(): string | undefined {
  const path = process.env[FAKE_IDE_ENV];
  if (typeof path !== 'string' || path.length === 0) {
    return undefined;
  }
  return path;
}

/**
 * Loads and parses the fake IDE fixture referenced by `LLXPRT_FAKE_IDE`.
 * Returns `undefined` when the seam is inactive or the file is unreadable.
 */
export function loadFakeIdeFixture(): FakeIdeFixture | undefined {
  const path = fakeIdeFixturePath();
  if (path === undefined) {
    return undefined;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as FakeIdeFixture;
  } catch {
    return undefined;
  }
}

/**
 * Marks the named IDE trusted in the fake fixture and persists the change so a
 * subsequent {@link loadFakeIdeFixture} reflects it. No-op when the seam is
 * inactive or the server is absent.
 */
export function trustFakeIde(name: string): void {
  const path = fakeIdeFixturePath();
  if (path === undefined) {
    return;
  }
  const fixture = loadFakeIdeFixture();
  if (fixture === undefined) {
    return;
  }
  const detected = fixture.detected.map((entry) =>
    entry.name === name ? { ...entry, trusted: true } : entry,
  );
  const next: FakeIdeFixture = {
    ...(fixture.currentName !== undefined
      ? { currentName: fixture.currentName }
      : {}),
    detected,
  };
  writeFileSync(path, JSON.stringify(next), 'utf8');
}
