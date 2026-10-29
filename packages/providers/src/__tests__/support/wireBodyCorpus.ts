/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A1: ties the histories, the routes and the fixtures
 * together. The golden test asks a {@link GoldenRecorder} to `check` each
 * captured request; in update mode the recorder records instead and writes
 * the fixtures once at the end (see wireBodyFixtures.ts for the command).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import {
  recordOf,
  sendThroughRoute,
  type MediaBinding,
  type RowSource,
  type WireBodyRecord,
  type WireRoute,
} from './wireBodyCapture.js';
import {
  describeDifference,
  readManifest,
  readRouteFixture,
  writeManifest,
  writeRouteFixture,
  type ContentLengthBehavior,
  type RouteFixture,
  type RouteManifestEntry,
} from './wireBodyFixtures.js';
import { buildHistoryCases, type HistoryCase } from './wireBodyHistories.js';

export const ROW_SOURCES: readonly RowSource[] = ['stream', 'rows'];

/** One byte-for-byte stable 1x1 image, admitted once into a scratch store. */
const CORPUS_IMAGE_BYTES = new Uint8Array([1, 2, 3]);
const MEDIA_BUDGET_BYTES = 1024 * 1024;

export interface Corpus {
  readonly store: LocalMediaStore;
  readonly binding: MediaBinding;
  readonly histories: readonly HistoryCase[];
  dispose(): Promise<void>;
}

export async function createCorpus(): Promise<Corpus> {
  const directory = await mkdtemp(join(tmpdir(), 'wire-body-golden-'));
  const store = new LocalMediaStore({
    rootDirectory: directory,
    quotaBytes: MEDIA_BUDGET_BYTES,
  });
  const imageReference = await store.admit({
    bytes: CORPUS_IMAGE_BYTES,
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  return {
    store,
    binding: {
      resolver: new RequestMediaResolver(store),
      budgetBytes: MEDIA_BUDGET_BYTES,
    },
    histories: buildHistoryCases({ imageReference }),
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}

export async function captureRecord(
  route: WireRoute,
  history: HistoryCase,
  source: RowSource,
  media: MediaBinding,
): Promise<WireBodyRecord> {
  const binding = history.usesMediaReferences === true ? media : undefined;
  return recordOf(await sendThroughRoute(route, history, source, binding));
}

type RecordedCases = Record<string, Record<RowSource, WireBodyRecord>>;
type RecordedSources = Map<RowSource, WireBodyRecord>;

function completeCases(
  route: string,
  recorded: ReadonlyMap<string, RecordedSources>,
): RecordedCases {
  const cases: RecordedCases = {};
  for (const [caseId, sources] of recorded) {
    const stream = sources.get('stream');
    const rows = sources.get('rows');
    if (stream === undefined || rows === undefined) {
      throw new Error(`route ${route} / ${caseId}: a row source was not run`);
    }
    cases[caseId] = { stream, rows };
  }
  return cases;
}

function uniformBehavior(
  route: string,
  source: RowSource,
  cases: RecordedCases,
): ContentLengthBehavior {
  const seen = [
    ...new Set(
      Object.values(cases).map((entry) => entry[source].contentLength),
    ),
  ];
  if (seen.length !== 1) {
    throw new Error(
      `route ${route} (${source}) mixes content-length behaviours: ${seen.join(', ')}`,
    );
  }
  return seen[0];
}

function manifestEntry(
  route: string,
  cases: RecordedCases,
): RouteManifestEntry {
  return {
    contentLength: {
      stream: uniformBehavior(route, 'stream', cases),
      rows: uniformBehavior(route, 'rows', cases),
    },
    cases: Object.keys(cases),
  };
}

export class GoldenRecorder {
  private readonly recorded = new Map<string, Map<string, RecordedSources>>();
  private readonly fixtures = new Map<string, RouteFixture>();

  constructor(private readonly update: boolean) {}

  private fixtureFor(route: string): RouteFixture {
    const cached = this.fixtures.get(route);
    if (cached !== undefined) return cached;
    const loaded = readRouteFixture(route);
    this.fixtures.set(route, loaded);
    return loaded;
  }

  /** Returns a description of any difference, or undefined when identical. */
  check(
    route: string,
    caseId: string,
    source: RowSource,
    actual: WireBodyRecord,
  ): string | undefined {
    if (this.update) {
      const cases = this.recorded.get(route) ?? new Map();
      const sources = cases.get(caseId) ?? new Map();
      sources.set(source, actual);
      cases.set(caseId, sources);
      this.recorded.set(route, cases);
      return undefined;
    }
    const expected = this.fixtureFor(route).cases[caseId]?.[source];
    if (expected === undefined) {
      return `no golden fixture for ${route} / ${caseId} / ${source}`;
    }
    return describeDifference(expected, actual);
  }

  /**
   * Problems with the fixture set as a whole: stale or missing cases, and a
   * manifest that no longer matches the fixtures. Empty in update mode.
   */
  verifyCorpus(
    histories: readonly HistoryCase[],
    routes: readonly WireRoute[],
  ): string[] {
    if (this.update) return [];
    const expectedCases = histories.map((history) => history.id);
    const manifest = readManifest();
    const problems: string[] = [];
    for (const route of routes) {
      const fixtureCases = this.fixtureFor(route.id).cases;
      const entry = manifest.routes[route.id];
      if (entry === undefined) {
        problems.push(`manifest has no entry for route ${route.id}`);
        continue;
      }
      problems.push(
        ...this.routeProblems(route.id, expectedCases, fixtureCases, entry),
      );
    }
    const knownRoutes = new Set(routes.map((route) => route.id));
    for (const manifestRoute of Object.keys(manifest.routes)) {
      if (!knownRoutes.has(manifestRoute)) {
        problems.push(`manifest names unknown route ${manifestRoute}`);
      }
    }
    return problems;
  }

  private routeProblems(
    route: string,
    expectedCases: readonly string[],
    fixtureCases: RouteFixture['cases'],
    entry: RouteManifestEntry,
  ): string[] {
    const problems: string[] = [];
    const fixtureIds = Object.keys(fixtureCases);
    if (fixtureIds.join('|') !== expectedCases.join('|')) {
      problems.push(
        `route ${route}: fixture cases [${fixtureIds.join(', ')}] differ from the corpus [${expectedCases.join(', ')}]`,
      );
    }
    if (entry.cases.join('|') !== expectedCases.join('|')) {
      problems.push(`route ${route}: manifest case list is out of date`);
    }
    for (const source of ROW_SOURCES) {
      const declared = entry.contentLength[source];
      for (const [caseId, bySource] of Object.entries(fixtureCases)) {
        const fixtureBehavior = bySource?.[source].contentLength;
        if (fixtureBehavior !== declared) {
          problems.push(
            `route ${route} / ${caseId} / ${source}: fixture says content-length ${fixtureBehavior}, manifest says ${declared}`,
          );
        }
      }
    }
    return problems;
  }

  /** Writes the recorded corpus when regenerating; does nothing otherwise. */
  flushIfUpdating(): void {
    if (!this.update) return;
    const manifestRoutes: Record<string, RouteManifestEntry> = {};
    for (const [route, recorded] of this.recorded) {
      const cases = completeCases(route, recorded);
      writeRouteFixture({ route, cases });
      manifestRoutes[route] = manifestEntry(route, cases);
    }
    writeManifest(manifestRoutes);
  }
}
