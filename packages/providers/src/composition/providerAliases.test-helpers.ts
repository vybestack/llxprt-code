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

import { vi, type Mock } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { loadProviderAliasEntries } from './providerAliases.js';

export async function loadWithTempConfig(
  tmpDir: string,
  filename: string,
  config: Record<string, unknown>,
): Promise<ReturnType<typeof loadProviderAliasEntries>> {
  const { Storage } = await import('@vybestack/llxprt-code-settings');
  const fakeLlxprtDir = path.join(tmpDir, '.llxprt');
  const fakeProvidersDir = path.join(fakeLlxprtDir, 'providers');
  fs.mkdirSync(fakeProvidersDir, { recursive: true });

  const configPath = path.join(fakeProvidersDir, filename);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  vi.spyOn(Storage, 'getGlobalDataDir').mockReturnValue(fakeLlxprtDir);

  try {
    return loadProviderAliasEntries();
  } finally {
    (
      Storage.getGlobalDataDir as Mock<typeof Storage.getGlobalDataDir>
    ).mockRestore();
  }
}
