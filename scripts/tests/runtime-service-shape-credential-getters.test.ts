/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { productionPolicy } from '../check-runtime-state-boundary.js';
import { scanRuntimeServiceShapes } from './runtime-service-shape-guard.js';

const keyStorageFile =
  'packages/storage/src/secure-store/provider-key-storage.ts';
const configFile = 'packages/core/src/config/config.ts';

const files = {
  [keyStorageFile]: `export interface ProviderKeyStorageLike {
  getKey(name: string): Promise<string | null>;
}`,
  [configFile]: `import type { ProviderKeyStorageLike } from '../../../storage/src/secure-store/provider-key-storage.js';
export class Config {
  getProviderKeys(): ProviderKeyStorageLike {
    throw new Error('fixture');
  }
}`,
  'consumer.ts': `import { Config } from './${configFile.replace(/\.ts$/, '.js')}';
export function use(config: Config): void {
  config.getProviderKeys();
}`,
};

describe('credential getters on Config', () => {
  it('reports a Config method returning the provider key storage as a service locator', () => {
    const findings = scanRuntimeServiceShapes(files, {
      services: [],
      configs: productionPolicy.configs.filter(
        (root) => root.file === configFile,
      ),
      runtimeObjects: (productionPolicy.runtimeObjects ?? []).filter(
        (root) => root.file === keyStorageFile,
      ),
      assembly: [],
    });

    expect(
      findings.map(({ rule, file, line }) => ({ rule, file, line })),
    ).toEqual([
      { rule: 'config-service-locator', file: 'consumer.ts', line: 3 },
    ]);
  });
});
