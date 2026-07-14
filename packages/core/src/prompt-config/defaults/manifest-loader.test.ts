import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  __resetManifestCacheForTests,
  getManifestOrigin,
  loadPromptFromManifest,
} from './manifest-loader.js';

describe('manifest-loader', () => {
  const envVar = 'LLXPRT_PROMPT_MANIFEST';
  let tempDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'llxprt-manifest-test-'));
    manifestPath = path.join(tempDir, 'default-prompts.json');
    process.env[envVar] = manifestPath;
    __resetManifestCacheForTests();
  });

  afterEach(() => {
    delete process.env[envVar];
    try {
      unlinkSync(manifestPath);
    } catch {
      // ignore
    }
    __resetManifestCacheForTests();
  });

  it('loads prompt content from the manifest when available', () => {
    writeFileSync(
      manifestPath,
      JSON.stringify({ 'core.md': '# Core Prompt' }, null, 2),
      'utf-8',
    );

    const content = loadPromptFromManifest('core.md');
    expect(content).toBe('# Core Prompt');
    expect(getManifestOrigin()).toBe(manifestPath);
  });

  it('returns null when manifest is missing or does not contain the file', () => {
    writeFileSync(manifestPath, JSON.stringify({}, null, 2), 'utf-8');
    const missing = loadPromptFromManifest('does-not-exist.md');
    expect(missing).toBeNull();
  });
});
