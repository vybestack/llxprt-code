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

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { loadWithTempConfig } from './providerAliases.test-helpers.js';

describe('providerAliases sandbox field validation', () => {
  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-sandbox-test-'));
    warnSpy = vi
      .spyOn(DebugLogger.prototype, 'warn')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preserves valid sandbox-base-url string', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'sandbox-valid.config', {
      name: 'sandbox-valid',
      baseProvider: 'openai',
      'sandbox-base-url': 'http://host.docker.internal:1234',
    });
    const entry = entries.find(
      (candidate) => candidate.alias === 'sandbox-valid',
    );
    expect(entry).toBeDefined();
    expect(entry?.config['sandbox-base-url']).toBe(
      'http://host.docker.internal:1234',
    );
  });

  it('drops non-string sandbox-base-url and warns', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'sandbox-bad-url.config', {
      name: 'sandbox-bad-url',
      baseProvider: 'openai',
      'sandbox-base-url': 12345,
    });
    const entry = entries.find(
      (candidate) => candidate.alias === 'sandbox-bad-url',
    );
    expect(entry).toBeDefined();
    expect(entry?.config['sandbox-base-url']).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('non-string sandbox-base-url'),
    );
  });

  it('preserves valid requires-auth boolean', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'auth-valid.config', {
      name: 'auth-valid',
      baseProvider: 'openai',
      'requires-auth': false,
    });
    const entry = entries.find((candidate) => candidate.alias === 'auth-valid');
    expect(entry).toBeDefined();
    expect(entry?.config['requires-auth']).toBe(false);
  });

  it('drops non-boolean requires-auth and warns', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'auth-bad.config', {
      name: 'auth-bad',
      baseProvider: 'openai',
      'requires-auth': 'yes',
    });
    const entry = entries.find((candidate) => candidate.alias === 'auth-bad');
    expect(entry).toBeDefined();
    expect(entry?.config['requires-auth']).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('non-boolean requires-auth'),
    );
  });
});
