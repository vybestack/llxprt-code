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
import { fileURLToPath } from 'url';
import { AssetLoader } from './assetLoader.js';
import { KIMI_K3_MANIFEST } from './kimiK3Tokenizer.js';
import { GLM_MANIFEST } from './glmTokenizer.js';
import { MINIMAX_MANIFEST } from './minimaxTokenizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, 'assets');

const ALL_MANIFESTS = [
  { manifest: KIMI_K3_MANIFEST, dir: 'kimi-k3' },
  { manifest: GLM_MANIFEST, dir: 'glm-5.2' },
  { manifest: MINIMAX_MANIFEST, dir: 'minimax-m3' },
];

describe('Offline asset smoke tests (acceptance criterion 5)', () => {
  it('all three model asset directories exist in the package', () => {
    for (const { dir } of ALL_MANIFESTS) {
      const dirPath = path.join(ASSETS_DIR, dir);
      expect(fs.existsSync(dirPath)).toBe(true);
    }
  });

  it('each model has tokenizer.bpe + manifest.json co-located', () => {
    for (const { dir } of ALL_MANIFESTS) {
      const bpe = path.join(ASSETS_DIR, dir, 'tokenizer.bpe');
      const manifestJson = path.join(ASSETS_DIR, dir, 'manifest.json');
      expect(fs.existsSync(bpe)).toBe(true);
      expect(fs.existsSync(manifestJson)).toBe(true);

      const stats = fs.statSync(bpe);
      expect(stats.size).toBeGreaterThan(100_000);
    }
  });

  it('NOTICE.md exists with license information', () => {
    const noticePath = path.join(ASSETS_DIR, 'NOTICE.md');
    expect(fs.existsSync(noticePath)).toBe(true);
    const content = fs.readFileSync(noticePath, 'utf-8');
    expect(content).toContain('Kimi K3');
    expect(content).toContain('GLM 5.2');
    expect(content).toContain('MiniMax M3');
  });

  it('all three BPE assets load offline with verified checksums', () => {
    const loader = new AssetLoader();
    for (const { manifest, dir } of ALL_MANIFESTS) {
      const bpe = loader.loadBpe(dir, manifest);
      expect(bpe.length).toBeGreaterThan(100_000);
    }
  });

  it('manifest.json files match the hardcoded manifest constants', () => {
    for (const { manifest, dir } of ALL_MANIFESTS) {
      const manifestPath = path.join(ASSETS_DIR, dir, 'manifest.json');
      const json = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(json.model).toBe(manifest.model);
      expect(json.sha256).toBe(manifest.sha256);
      expect(json.revision).toBe(manifest.revision);
      expect(json.license).toBe(manifest.license);
    }
  });
});
