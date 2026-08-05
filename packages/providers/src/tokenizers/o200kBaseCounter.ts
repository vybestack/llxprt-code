/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as Tiktoken from '@dqbd/tiktoken';

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

let sharedEncoder: Promise<O200kBaseEncoder> | undefined;

async function createEncoder(
  loadModule: TiktokenModuleLoader,
): Promise<O200kBaseEncoder> {
  const { get_encoding } = await loadModule();
  return get_encoding('o200k_base');
}

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
  sharedEncoder ??= createEncoder(loadModule);
  return sharedEncoder;
}

/**
 * Count `text` as ordinary BPE text. Special-token-looking text is encoded as
 * its constituent bytes and can never be promoted to a control token.
 */
export function countO200kBaseTokens(
  encoder: O200kBaseEncoder,
  text: string,
): number {
  return encoder.encode(text, [], []).length;
}
