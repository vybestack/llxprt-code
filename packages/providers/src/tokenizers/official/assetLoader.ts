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

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import type { AssetManifest } from './assetManifest.js';
import {
  assetMissingError,
  assetCorruptError,
  checksumMismatchError,
} from './errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolved relative to this module, which is correct under both published
// layouts because the package exports resolve differently per runtime:
//
//   Node (import/main) -> dist/src/tokenizers/official/assets/
//   Bun  (bun export condition, which serves TypeScript source)
//                       -> src/tokenizers/official/assets/
//
// Both copies are therefore load-bearing and must ship: the dist copy is
// produced by scripts/copy_files.ts, and the src copy is the checked-in
// original. Removing either one breaks that runtime's consumers, so this is
// deliberate duplication rather than redundancy.
const ASSETS_DIR = path.join(__dirname, 'assets');

/**
 * Reads and verifies a pinned tokenizer BPE asset.
 *
 * The asset is loaded offline from the package bundle. Its SHA-256 is
 * checked against the manifest before the BPE data is returned.
 *
 * Results are cached so repeated calls for the same model do not re-read
 * or re-hash the file.
 */
export class AssetLoader {
  private readonly cache = new Map<string, string>();

  /**
   * @param assetsDir Override the assets directory (for testing).
   */
  constructor(private readonly assetsDir: string = ASSETS_DIR) {}

  /**
   * Load and verify the BPE asset for the given model directory.
   *
   * @param modelDir Subdirectory under assets/ (e.g. "kimi-k3").
   * @param manifest The manifest with the expected checksum.
   * @returns The raw BPE file content as a string (tiktoken format).
   */
  loadBpe(modelDir: string, manifest: AssetManifest): string {
    const cached = this.cache.get(modelDir);
    if (cached !== undefined) {
      return cached;
    }

    const assetPath = path.join(this.assetsDir, modelDir, manifest.assetFile);
    if (!fs.existsSync(assetPath)) {
      throw assetMissingError(manifest.model, assetPath);
    }

    let content: string;
    try {
      content = fs.readFileSync(assetPath, 'utf-8');
    } catch (e) {
      throw assetCorruptError(
        manifest.model,
        assetPath,
        e instanceof Error ? e.message : String(e),
        e,
      );
    }

    const actualHash = crypto
      .createHash('sha256')
      .update(content, 'utf-8')
      .digest('hex');

    if (actualHash !== manifest.sha256) {
      throw checksumMismatchError(
        manifest.model,
        assetPath,
        manifest.sha256,
        actualHash,
      );
    }

    this.cache.set(modelDir, content);
    return content;
  }

  /** Clear the in-memory cache. */
  clearCache(): void {
    this.cache.clear();
  }
}
