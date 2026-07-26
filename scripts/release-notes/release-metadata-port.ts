/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import type { ReleaseMetadata, ReleaseMetadataPort } from './types.js';
import type { ReleaseMetadataLookup } from './diff-selection.js';

export type GhRunner = (args: readonly string[]) => string;

const defaultRunner: GhRunner = (args) =>
  execFileSync('gh', [...args], { encoding: 'utf8', timeout: 15_000 });

const publishedAtSchema = z.object({
  publishedAt: z.string().nullable(),
});
const releaseListSchema = z.array(
  z.object({ tagName: z.string(), publishedAt: z.string().nullable() }),
);

const UNKNOWN: ReleaseMetadata = Object.freeze({ status: 'unknown' });
const CONFIRMED_ABSENT: ReleaseMetadata = Object.freeze({
  status: 'confirmed-absent',
});

export function parseReleaseMetadata(raw: string): ReleaseMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return UNKNOWN;
  }
  const result = publishedAtSchema.safeParse(parsed);
  if (!result.success) {
    return UNKNOWN;
  }
  if (result.data.publishedAt === null) {
    return CONFIRMED_ABSENT;
  }
  const publishedAt = Date.parse(result.data.publishedAt);
  if (Number.isNaN(publishedAt)) {
    return UNKNOWN;
  }
  return Object.freeze({ status: 'published', publishedAt });
}

export const MAX_RELEASE_METADATA = 1000;

export function createReleaseMetadataPort(
  runner: GhRunner = defaultRunner,
): ReleaseMetadataPort {
  let cache: ReadonlyMap<string, ReleaseMetadata> = new Map();
  let complete = false;
  let loaded = false;
  let loadAttempts = 0;
  let loading: Promise<void> | null = null;
  const load = async (): Promise<void> => {
    loadAttempts += 1;
    try {
      const raw = runner([
        'release',
        'list',
        '--limit',
        String(MAX_RELEASE_METADATA),
        '--json',
        'tagName,publishedAt',
      ]);
      const parsed = releaseListSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        loaded = loadAttempts >= 2;
        console.warn('GitHub release metadata response was invalid.');
        return;
      }
      loaded = true;
      complete = parsed.data.length < MAX_RELEASE_METADATA;
      cache = new Map(
        parsed.data.map((release) => [
          release.tagName,
          parseReleaseMetadata(JSON.stringify(release)),
        ]),
      );
    } catch {
      loaded = loadAttempts >= 2;
      console.warn('GitHub release metadata lookup failed.');
    }
  };
  return {
    async getReleaseMetadata(tag: string): Promise<ReleaseMetadata> {
      if (loaded) {
        return cache.get(tag) ?? (complete ? CONFIRMED_ABSENT : UNKNOWN);
      }
      if (loading === null) {
        loading = load().finally(() => {
          loading = null;
        });
      }
      await loading;
      return cache.get(tag) ?? (complete ? CONFIRMED_ABSENT : UNKNOWN);
    },
  };
}

export function createStaticReleaseMetadataPort(
  map: ReadonlyMap<string, ReleaseMetadata>,
): ReleaseMetadataPort {
  return {
    async getReleaseMetadata(tag: string): Promise<ReleaseMetadata> {
      return map.get(tag) ?? UNKNOWN;
    },
  };
}

export const MAX_NIGHTLY_CANDIDATES = MAX_RELEASE_METADATA;

export async function createBoundedReleaseMetadataLookup(
  port: ReleaseMetadataPort,
  candidates: readonly string[],
): Promise<ReleaseMetadataLookup | undefined> {
  const bounded = candidates.slice(0, MAX_NIGHTLY_CANDIDATES);
  if (bounded.length === 0) {
    return undefined;
  }
  const [firstTag, ...remainingTags] = bounded;
  if (firstTag === undefined) {
    return undefined;
  }
  const initial = await port.getReleaseMetadata(firstTag);
  const firstResult =
    initial.status === 'unknown'
      ? await port.getReleaseMetadata(firstTag)
      : initial;
  const metadata = await Promise.all(
    remainingTags.map(async (tag) => ({
      tag,
      release: await port.getReleaseMetadata(tag),
    })),
  );
  const resolved = new Map<string, ReleaseMetadata>([[firstTag, firstResult]]);
  metadata.forEach(({ tag, release }) => {
    resolved.set(tag, release);
  });
  const lookup = Object.assign(
    (tag: string): ReleaseMetadata => resolved.get(tag) ?? UNKNOWN,
    { candidates: new Set(bounded) },
  );
  return lookup;
}
