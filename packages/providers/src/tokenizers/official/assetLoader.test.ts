/**
 * Copyright 2025 Vybestack LLC
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

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { AssetLoader } from './assetLoader.js';
import { KIMI_K3_MANIFEST } from './kimiK3Tokenizer.js';
import { OfficialTokenizerError } from './errors.js';

/** Capture the thrown value (or undefined) from a function. */
function captureThrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('AssetLoader', () => {
  it('loads a valid BPE asset and verifies its SHA-256 checksum', () => {
    const loader = new AssetLoader();
    const bpe = loader.loadBpe('kimi-k3', KIMI_K3_MANIFEST);
    expect(bpe.length).toBeGreaterThan(100_000);
    expect(bpe).toContain('\n');
  });

  it('caches loaded content (returns after file deletion)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-cache-'));
    try {
      const modelDir = path.join(tmpDir, 'cached-model');
      fs.mkdirSync(modelDir);
      const content = 'QWJD\nQUNF\n';
      fs.writeFileSync(path.join(modelDir, 'tokenizer.bpe'), content);
      const sha = crypto.createHash('sha256').update(content).digest('hex');

      const manifest = {
        ...KIMI_K3_MANIFEST,
        model: 'cached-model',
        sha256: sha,
      };
      const loader = new AssetLoader(tmpDir);
      const first = loader.loadBpe('cached-model', manifest);
      fs.unlinkSync(path.join(modelDir, 'tokenizer.bpe'));
      const second = loader.loadBpe('cached-model', manifest);
      expect(second).toBe(first);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('throws OfficialTokenizerError with asset-missing kind when file absent', () => {
    const loader = new AssetLoader('/nonexistent/path');
    const thrown = captureThrown(() =>
      loader.loadBpe('kimi-k3', KIMI_K3_MANIFEST),
    );
    expect(thrown).toBeInstanceOf(OfficialTokenizerError);
    expect((thrown as OfficialTokenizerError).kind).toBe('asset-missing');
    expect((thrown as OfficialTokenizerError).model).toBe('kimi-k3');
    expect((thrown as OfficialTokenizerError).assetPath).toContain('kimi-k3');
  });

  it('throws OfficialTokenizerError with checksum-mismatch kind when SHA differs', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-tok-test-'));
    try {
      const modelDir = path.join(tmpDir, 'fake-model');
      fs.mkdirSync(modelDir);
      fs.writeFileSync(path.join(modelDir, 'tokenizer.bpe'), 'wrong content');

      const badManifest = {
        ...KIMI_K3_MANIFEST,
        model: 'fake-model',
        sha256:
          '0000000000000000000000000000000000000000000000000000000000000000',
      };
      const loader = new AssetLoader(tmpDir);
      const thrown = captureThrown(() =>
        loader.loadBpe('fake-model', badManifest),
      );

      expect(thrown).toBeInstanceOf(OfficialTokenizerError);
      expect((thrown as OfficialTokenizerError).kind).toBe('checksum-mismatch');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
