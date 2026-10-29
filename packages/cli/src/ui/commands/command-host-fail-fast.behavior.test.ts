/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { bindProviderCommandOperations } from './providerCommandHost.js';
import { bindMemoryCommand } from './memoryCommandHost.js';

describe('required command host ownership', () => {
  it('preserves a broken provider read instead of displaying a different status provider', () => {
    const failure = new Error('provider owner failed');
    const operations = bindProviderCommandOperations(
      () => {
        throw failure;
      },
      () => 'model',
      () => {
        throw new Error('Alias resolution is not exercised');
      },
      async () => {
        throw new Error('Provider switch is not exercised');
      },
      async () => {},
      async () => {},
    );
    expect(() => operations.getActiveProviderName()).toThrow(failure);
  });

  it('rejects missing memory ownership at registration instead of manufacturing empty memory', () => {
    expect(() =>
      Reflect.apply(bindMemoryCommand, undefined, [null, () => 0, () => {}]),
    ).toThrow(/null/);
  });
});
