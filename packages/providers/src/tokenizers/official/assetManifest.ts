/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Manifest describing a pinned offline tokenizer asset.
 *
 * Every asset is pinned by immutable upstream revision and SHA-256
 * checksum. The manifest is co-located with the BPE file so the loader
 * can verify integrity at load time.
 */
export interface AssetManifest {
  /** Canonical model identifier (e.g. "kimi-k3"). */
  readonly model: string;
  /** Upstream repository (e.g. "huggingface.co/moonshotai/Kimi-K3"). */
  readonly source: string;
  /** Immutable upstream git revision (commit SHA). */
  readonly revision: string;
  /** Original asset filename in the upstream repo. */
  readonly sourceFile: string;
  /** Local BPE asset filename (relative to the manifest directory). */
  readonly assetFile: string;
  /** SHA-256 of the local BPE file content. */
  readonly sha256: string;
  /** SPDX license identifier or short license name. */
  readonly license: string;
  /**
   * Conversion provenance. "direct" = the BPE file is the original
   * upstream asset. "hf-bpe-to-tiktoken" = converted from a Hugging Face
   * tokenizer.json byte-level BPE vocabulary.
   */
  readonly conversion: 'direct' | 'hf-bpe-to-tiktoken';
}
