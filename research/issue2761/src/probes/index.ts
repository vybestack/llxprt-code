/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Probe } from '../harness.ts';
import { p01ApiKeyAuth } from './p01-api-key-auth.ts';
import { p02NonStreaming } from './p02-non-streaming.ts';
import { p03StreamingUsage } from './p03-streaming-usage.ts';
import { p04ParallelToolsIds } from './p04-parallel-tools-ids.ts';
import { p05Schemas } from './p05-schemas.ts';
import { p06ThoughtSignatures } from './p06-thought-signatures.ts';
import { p07ThinkingConfig } from './p07-thinking-config.ts';
import { p08Media } from './p08-media.ts';
import { p09ExecutableCode } from './p09-executable-code.ts';
import { p10ErrorSafetyFinish } from './p10-error-safety-finish.ts';
import { p11Abort } from './p11-abort.ts';
import { p12BaseurlFetchDumps } from './p12-baseurl-fetch-dumps.ts';
import { p13GroundingUrlMetadata } from './p13-grounding-url-metadata.ts';
import { p14ModelListing } from './p14-model-listing.ts';

/** Probe execution order. */
export const PROBES: readonly Probe[] = [
  p01ApiKeyAuth,
  p02NonStreaming,
  p03StreamingUsage,
  p04ParallelToolsIds,
  p05Schemas,
  p06ThoughtSignatures,
  p07ThinkingConfig,
  p08Media,
  p09ExecutableCode,
  p10ErrorSafetyFinish,
  p11Abort,
  p12BaseurlFetchDumps,
  p13GroundingUrlMetadata,
  p14ModelListing,
];
