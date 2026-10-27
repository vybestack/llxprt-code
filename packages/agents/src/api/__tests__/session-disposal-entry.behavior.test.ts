/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openSessionClientEngine } from './helpers/session-client-engine.js';

describe('Session disposal entry', () => {
  const credentials = useOwnedCredentials();
  it('joins repeated disposal without closing an admission resource twice', async () => {
    const engine = await openSessionClientEngine(credentials().authority);
    const owner = await engine.createOwner(buildAgentClientFactory());
    const descriptor = openSync(join(engine.directory, 'admission'), 'w');
    const closeAdmission = owner.clients.closeAdmission.bind(owner.clients);
    owner.clients.closeAdmission = () => {
      closeSync(descriptor);
      closeAdmission();
    };
    try {
      const closing = owner.dispose();
      expect(owner.dispose()).toBe(closing);
      await closing;
      expect(owner.dispose()).toBe(closing);
    } finally {
      await engine.close();
    }
  });
});
