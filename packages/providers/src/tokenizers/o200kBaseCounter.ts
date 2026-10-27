/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as Tiktoken from '@dqbd/tiktoken';
import { countLongNeutralText } from '@vybestack/llxprt-code-core/utils/neutral-long-piece.js';

/**
 * Provenance of the pinned local `o200k_base` BPE asset.
 *
 * This is a *base counter*. For OpenAI GPT-5.6 it is the model's official
 * codec, so counts there are exact. For any other family it is only a stable,
 * offline lexical base that a separate calibration layer corrects; it is never
 * that family's tokenizer.
 */
export const O200K_BASE_ASSET_REVISION =
  'o200k_base:446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d:@dqbd/tiktoken@1.0.22';

type TiktokenModule = typeof Tiktoken;
export type TiktokenModuleLoader = () => Promise<TiktokenModule>;
export type O200kBaseEncoder = ReturnType<TiktokenModule['get_encoding']>;

export const loadTiktokenModule: TiktokenModuleLoader = () =>
  import('@dqbd/tiktoken');

async function createEncoder(
  loadModule: TiktokenModuleLoader,
): Promise<O200kBaseEncoder> {
  const { get_encoding } = await loadModule();
  return get_encoding('o200k_base');
}

export type O200kBaseEncoderResolver = () => Promise<O200kBaseEncoder>;

/**
 * Cache a successfully initialized encoder, but never a failed attempt.
 *
 * Concurrent callers share the one in-flight attempt, so a failure is
 * surfaced to each of them. The failed attempt is then dropped, and the next
 * independent call initializes again instead of replaying a stale rejection
 * for the life of the process. There is no retry loop here: a retry happens
 * only because a caller asked again. At most one attempt is ever pending, so
 * a failed attempt can only clear its own entry.
 */
function createRetainOnSuccessResolver(
  loadModule: TiktokenModuleLoader,
): O200kBaseEncoderResolver {
  let pending: Promise<O200kBaseEncoder> | undefined;
  return () => {
    if (pending === undefined) {
      const attempt = createEncoder(loadModule);
      pending = attempt;
      attempt.catch(() => {
        pending = undefined;
      });
    }
    return pending;
  };
}

const resolveSharedEncoder = createRetainOnSuccessResolver(loadTiktokenModule);

/**
 * Resolve the process-wide `o200k_base` encoder.
 *
 * Every consumer shares one WASM encoder instance so that adding a second
 * family built on this base does not double the resident tokenizer memory.
 * A caller-supplied loader bypasses the shared instance so tests can inject
 * failures without poisoning the cache.
 */
export function getO200kBaseEncoder(
  loadModule: TiktokenModuleLoader = loadTiktokenModule,
): Promise<O200kBaseEncoder> {
  if (loadModule !== loadTiktokenModule) {
    return createEncoder(loadModule);
  }
  return resolveSharedEncoder();
}

export function createO200kBaseEncoderResolver(
  loadModule: TiktokenModuleLoader = loadTiktokenModule,
): O200kBaseEncoderResolver {
  if (loadModule === loadTiktokenModule) {
    return resolveSharedEncoder;
  }
  return createRetainOnSuccessResolver(loadModule);
}

/**
 * Count `text` as ordinary BPE text. Special-token-looking text is encoded as
 * its constituent bytes and can never be promoted to a control token.
 */
export function countO200kBaseTokens(
  encoder: O200kBaseEncoder,
  text: string,
): number {
  return countLongNeutralText(
    text,
    (piece) => encoder.encode(piece, [], []).length,
  );
}
