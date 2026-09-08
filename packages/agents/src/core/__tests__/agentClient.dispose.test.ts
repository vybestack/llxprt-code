/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { AgentClient } from '../client.js';

describe('AgentClient.dispose', () => {
  it('calls unsubscribe and clears _unsubscribe, ignoring repeated calls', async () => {
    const client = Object.create(AgentClient.prototype) as AgentClient & {
      _unsubscribe?: () => void;
      handleModelChanged?: () => void;
      handleModelProfileChanged?: () => void;
    };
    let unsubscribeCount = 0;
    client['_unsubscribe'] = () => {
      unsubscribeCount += 1;
    };
    client['handleModelChanged'] = () => undefined;
    client['handleModelProfileChanged'] = () => undefined;
    Object.defineProperty(client, 'historyAdmissions', {
      value: {
        all: [],
        release: async () => [],
      },
    });

    await client.dispose();
    expect(unsubscribeCount).toBe(1);
    expect(client['_unsubscribe']).toBeUndefined();

    await client.dispose();
    expect(unsubscribeCount).toBeLessThan(2);
  });
});
