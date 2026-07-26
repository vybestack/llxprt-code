#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReleaseNotes } from './release-notes/orchestrator.js';
import {
  selectDiffBase,
  nightlyCandidateNames,
} from './release-notes/diff-selection.js';
import { loadCuratedHeadline } from './release-notes/curated-headline.js';
import {
  getCommits,
  getAllCommits,
  listTags,
  createTopologyResolver,
  getRootCommit,
} from './release-notes/git-port.js';
import { createGhPort, MAX_ENRICHED_REFS } from './release-notes/gh-port.js';
import { createLlmPort } from './release-notes/llm-port.js';
import { createNullLlmPort } from './release-notes/null-llm-port.js';
import {
  createReleaseMetadataPort,
  createBoundedReleaseMetadataLookup,
} from './release-notes/release-metadata-port.js';
import { computeContributors } from './release-notes/contributors.js';
import type { EnrichedRef, GhPort, LlmPort } from './release-notes/types.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface EnvConfig {
  readonly releaseTag: string;
  readonly isNightly: boolean;
  readonly repository: string;
  readonly provider: string;
  readonly model: string;
  readonly apiKey: string;
  readonly keyfilePath: string | undefined;
  readonly baseUrl: string | undefined;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Required environment variable ${name} is not set.`);
  }
  return value;
}

/**
 * Reads the API key from a keyfile path when provided (supported secure
 * mechanism via the CLI `--keyfile` flag), falling back to the OPENAI_API_KEY
 * environment variable. Returns an empty string when neither is available,
 * which selects the deterministic null-LLM fallback path.
 *
 * Keys containing CR/LF characters are rejected: a newline in the key would
 * corrupt the keyfile (each line becomes a separate token) and can break
 * downstream auth headers.
 */
function readApiKey(): { key: string; keyfilePath: string | undefined } {
  const keyfileEnv = process.env.OPENAI_API_KEY_FILE;
  if (keyfileEnv !== undefined && keyfileEnv.length > 0) {
    try {
      const key = readFileSync(keyfileEnv, 'utf-8').trim();
      if (key.length > 0 && !hasNewline(key)) {
        return { key, keyfilePath: resolve(keyfileEnv) };
      }
    } catch {
      // Fall through to env-based key.
    }
  }
  const envKey = process.env.OPENAI_API_KEY ?? '';
  if (hasNewline(envKey)) {
    return { key: '', keyfilePath: undefined };
  }
  return { key: envKey, keyfilePath: undefined };
}

/**
 * Returns true when the value contains CR or LF characters. Such characters
 * are not valid in API keys and would corrupt keyfile writes or auth headers.
 */
function hasNewline(value: string): boolean {
  return value.includes('\r') || value.includes('\n');
}

function readEnvConfig(): EnvConfig {
  const { key, keyfilePath } = readApiKey();
  return {
    releaseTag: requireEnv('RELEASE_TAG'),
    isNightly: process.env.IS_NIGHTLY === 'true',
    repository: requireEnv('GITHUB_REPOSITORY'),
    provider: process.env.LLXPRT_DEFAULT_PROVIDER ?? '',
    model: process.env.LLXPRT_DEFAULT_MODEL ?? '',
    apiKey: key,
    keyfilePath,
    baseUrl: process.env.OPENAI_BASE_URL,
  };
}

function createCachedGhPort(delegate: GhPort): GhPort {
  const cache = new Map<number, EnrichedRef>();
  const attempted = new Set<number>();
  return {
    async fetchRefs(numbers) {
      const remainingBudget = Math.max(0, MAX_ENRICHED_REFS - attempted.size);
      const missing = numbers
        .filter((number) => !attempted.has(number))
        .slice(0, remainingBudget);
      if (missing.length > 0) {
        for (const number of missing) {
          attempted.add(number);
        }
        const fetched = await delegate.fetchRefs(missing);
        for (const [number, ref] of fetched) {
          cache.set(number, ref);
        }
      }
      const result = new Map<number, EnrichedRef>();
      for (const number of numbers) {
        const ref = cache.get(number);
        if (ref !== undefined) {
          result.set(number, ref);
        }
      }
      return result;
    },
  };
}

function createConfiguredLlmPort(config: EnvConfig): LlmPort {
  const provider = config.provider.trim();
  const model = config.model.trim();
  const apiKey = config.apiKey.trim();
  if (provider.length === 0 || model.length === 0 || apiKey.length === 0) {
    return createNullLlmPort();
  }
  return createLlmPort({
    provider,
    model,
    apiKey,
    keyfilePath: config.keyfilePath,
    baseUrl: config.baseUrl,
    temperature: 0.1,
  });
}

async function main(): Promise<void> {
  const config = readEnvConfig();
  const tags = listTags();
  const nightlyCandidates = config.isNightly
    ? nightlyCandidateNames(tags, config.releaseTag)
    : [];
  const releaseMetadataLookup = config.isNightly
    ? await createBoundedReleaseMetadataLookup(
        createReleaseMetadataPort(),
        nightlyCandidates,
      )
    : undefined;
  const diffBase = selectDiffBase(
    tags,
    config.releaseTag,
    config.isNightly,
    releaseMetadataLookup,
  );
  let lastTag: string;
  let isFirstRelease: boolean;
  if (diffBase !== null) {
    lastTag = diffBase;
    isFirstRelease = false;
  } else {
    const rootCommit = getRootCommit();
    if (rootCommit === null) {
      throw new Error(
        `No suitable diff base tag found for ${config.releaseTag}, and the repository has no root commit.`,
      );
    }
    lastTag = rootCommit;
    isFirstRelease = true;
  }

  const rawCommits = isFirstRelease ? getAllCommits() : getCommits(lastTag);
  const ghPort = createCachedGhPort(createGhPort(config.repository));
  const releaseContributors = await computeContributors(ghPort, rawCommits);
  const releaseVersion = config.releaseTag.replace(/^v/, '');
  const curatedHeadline = config.isNightly
    ? null
    : loadCuratedHeadline(join(ROOT, 'docs', 'release-notes'), releaseVersion);
  const markdown = await generateReleaseNotes({
    releaseTag: config.releaseTag,
    lastTag,
    isFirstRelease,
    isNightly: config.isNightly,
    rawCommits,
    contributors: releaseContributors,
    ghPort,
    llmPort: createConfiguredLlmPort(config),
    curatedHeadline,
    repository: config.repository,
    topologyResolver: createTopologyResolver(),
  });

  writeFileSync(join(ROOT, 'release-notes.md'), markdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error generating release notes: ${message}`);
  process.exitCode = 1;
});
