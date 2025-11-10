/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { GeminiClient } from '../client.js';

describe('GeminiClient.dispose', () => {
  it('invokes the runtime unsubscribe exactly once', () => {
    const client = Object.create(GeminiClient.prototype) as GeminiClient & {
      _unsubscribe?: () => void;
    };
    const unsubscribe = vi.fn();
    client['_unsubscribe'] = unsubscribe;

    client.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(client['_unsubscribe']).toBeUndefined();

    client.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
