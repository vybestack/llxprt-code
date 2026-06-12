/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentClient } from '../client.js';

describe('AgentClient.dispose', () => {
  it('calls unsubscribe and clears _unsubscribe, ignoring repeated calls', () => {
    const client = Object.create(AgentClient.prototype) as AgentClient & {
      _unsubscribe?: () => void;
      handleModelChanged?: () => void;
    };
    const unsubscribe = vi.fn();
    const handleModelChanged = vi.fn();
    client['_unsubscribe'] = unsubscribe;
    client['handleModelChanged'] = handleModelChanged;

    client.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(client['_unsubscribe']).toBeUndefined();

    client.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
