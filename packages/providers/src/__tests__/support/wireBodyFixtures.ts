/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A1: storage, comparison and regeneration of the golden
 * wire-body fixtures.
 *
 * Fixtures live in `__tests__/fixtures/wire-bodies/`:
 *
 * - `<route>.json`   one file per route: every history case, for both row
 *                    sources, with sha256 + byte length (+ full body text when
 *                    it is small) and the observed Content-Length behaviour.
 * - `manifest.json`  the corpus metadata: routes, case ids, and the current
 *                    Content-Length behaviour per route and row source, so a
 *                    later step that changes it has one place to assert from.
 *
 * REGENERATION (intentional updates only, never CI):
 *
 *   WIRE_BODY_GOLDEN_UPDATE=1 bun test src/__tests__/wireBodyGolden.test.ts
 *
 * run from `packages/providers`. The fixtures are the regression net for the
 * #854 no-array send work: request bytes must stay identical, and only the
 * Content-Length header may change on purpose. Regenerate only when a change
 * is meant to alter bytes, and review the fixture diff in the same commit.
 * The test refuses to regenerate when `CI` is set.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowSource, WireBodyRecord } from './wireBodyCapture.js';

export type ContentLengthBehavior = 'present' | 'absent';

export interface RouteFixture {
  readonly route: string;
  readonly cases: Readonly<
    Record<string, Readonly<Record<RowSource, WireBodyRecord>> | undefined>
  >;
}

export interface RouteManifestEntry {
  /** Content-Length behaviour of every case on this route, per row source. */
  readonly contentLength: Readonly<Record<RowSource, ContentLengthBehavior>>;
  /**
   * Why a row source on this route is still sent chunked, and which later
   * step removes that. Only valid for a source whose behaviour is `absent`.
   */
  readonly chunkedUntil?: Readonly<Partial<Record<RowSource, string>>>;
  readonly cases: readonly string[];
}

export interface CorpusManifest {
  readonly description: string;
  /** The wall-clock instant the corpus pins, for clock-derived ids. */
  readonly pinnedClock: string;
  readonly routes: Readonly<Record<string, RouteManifestEntry | undefined>>;
}

export const UPDATE_ENV = 'WIRE_BODY_GOLDEN_UPDATE';

export const PINNED_CLOCK = '2026-01-02T03:04:05.678Z';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'wire-bodies',
);

const MANIFEST_DESCRIPTION =
  'Golden request bytes for the real provider send paths (issue #854 step A1). ' +
  `Regenerate intentionally with ${UPDATE_ENV}=1; never in CI.`;

export function isUpdateRequested(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (env[UPDATE_ENV] !== '1') return false;
  if (env['CI'] !== undefined && env['CI'] !== '') {
    throw new Error(
      `${UPDATE_ENV}=1 must not be used when CI is set: golden fixtures are only regenerated intentionally by a person`,
    );
  }
  return true;
}

function routePath(route: string): string {
  return join(FIXTURE_DIR, `${route}.json`);
}

function manifestPath(): string {
  return join(FIXTURE_DIR, 'manifest.json');
}

function readFixtureText(path: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `missing golden fixture ${path}; regenerate intentionally with ${UPDATE_ENV}=1`,
    );
  }
  return readFileSync(path, 'utf8');
}

export function readRouteFixture(route: string): RouteFixture {
  const fixture: RouteFixture = JSON.parse(readFixtureText(routePath(route)));
  return fixture;
}

export function readManifest(): CorpusManifest {
  const manifest: CorpusManifest = JSON.parse(readFixtureText(manifestPath()));
  return manifest;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeRouteFixture(fixture: RouteFixture): void {
  writeJson(routePath(fixture.route), fixture);
}

export function writeManifest(
  routes: Readonly<Record<string, RouteManifestEntry>>,
): void {
  const manifest: CorpusManifest = {
    description: MANIFEST_DESCRIPTION,
    pinnedClock: PINNED_CLOCK,
    routes,
  };
  writeJson(manifestPath(), manifest);
}

function firstDifference(expected: string, actual: string): number {
  const shorter = Math.min(expected.length, actual.length);
  let at = 0;
  while (at < shorter && expected.charCodeAt(at) === actual.charCodeAt(at)) {
    at += 1;
  }
  return at;
}

function excerpt(text: string, at: number): string {
  return JSON.stringify(text.slice(Math.max(0, at - 60), at + 100));
}

/**
 * Describes how `actual` differs from `expected`, or returns undefined when
 * the request bytes and the Content-Length behaviour are identical.
 */
export function describeDifference(
  expected: WireBodyRecord,
  actual: WireBodyRecord,
): string | undefined {
  const problems: string[] = [];
  if (expected.sha256 !== actual.sha256 || expected.length !== actual.length) {
    problems.push(
      `bytes differ: expected ${expected.length} bytes sha256 ${expected.sha256}, got ${actual.length} bytes sha256 ${actual.sha256}`,
    );
    if (expected.body !== undefined && actual.body !== undefined) {
      const at = firstDifference(expected.body, actual.body);
      problems.push(
        `first difference at char ${at}: expected ${excerpt(expected.body, at)} got ${excerpt(actual.body, at)}`,
      );
    }
  }
  if (expected.contentLength !== actual.contentLength) {
    problems.push(
      `content-length was ${expected.contentLength} and is now ${actual.contentLength}`,
    );
  }
  return problems.length === 0 ? undefined : problems.join('\n');
}
