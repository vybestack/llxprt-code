/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { connectIdeClientIfEnabled } from './cliProviderInit.js';

describe('connectIdeClientIfEnabled', () => {
  it('does not connect when IDE mode is disabled', async () => {
    const connectionState = { connected: false };

    await connectIdeClientIfEnabled(
      () => false,
      async () => {
        connectionState.connected = true;
      },
    );

    expect(connectionState.connected).toBe(false);
  });

  it('connects the enabled IDE client', async () => {
    const connectionState = { connected: false };

    await connectIdeClientIfEnabled(
      () => true,
      async () => {
        connectionState.connected = true;
      },
    );

    expect(connectionState.connected).toBe(true);
  });
});
