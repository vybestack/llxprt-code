/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readSync } from 'node:fs';
import {
  HostCredentialOwner,
  closeOwnedTokenStore,
} from '../credential-store-factory.js';

/**
 * Child process for credential-authority.test.ts. The parent hands it the
 * capability token on an extra stdio slot (fd 3), the same delivery
 * packages/cli/bin/llxprt.mjs uses when it forwards the descriptor to Bun.
 *
 * argv[2] selects the report: "capture" (what the owner left behind) or
 * "requests" (token, key and broker requests through the captured authority).
 */

function descriptorIsClosed(): boolean {
  try {
    readSync(3, Buffer.alloc(1), 0, 1, null);
    return false;
  } catch {
    return true;
  }
}

function reportCapture(): void {
  let error: string | null = null;
  let authority: HostCredentialOwner['authority'] | undefined;
  try {
    authority = new HostCredentialOwner(process.env).authority;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  process.stdout.write(
    JSON.stringify({
      error,
      closed: descriptorIsClosed(),
      markerGone: process.env.LLXPRT_CAPABILITY_FD === undefined,
      serialized: JSON.stringify(authority),
    }),
  );
}

async function reportRequests(): Promise<void> {
  const authority = new HostCredentialOwner(process.env).authority;
  const markerGone = process.env.LLXPRT_CAPABILITY_FD === undefined;
  process.env.LLXPRT_CREDENTIAL_SOCKET = '/replacement.sock';
  const store = authority.createTokenStore();
  const keys = authority.createProviderKeyStorage();
  const broker = authority.createGitHubBrokerSocketClient();
  if (broker === null) {
    throw new Error('Captured authority has no broker transport');
  }
  try {
    const token = await store.getToken('test');
    if (token === null) throw new Error('Captured authority returned no token');
    const key = await keys.getKey('primary');
    const response = await broker.request('get_api_key', {
      name: 'primary',
    });
    process.stdout.write(
      JSON.stringify({
        markerGone,
        tokenType: token.token_type,
        key,
        brokerKey: (response.data as { key?: string }).key,
        serialized: JSON.stringify(authority),
      }),
    );
  } finally {
    closeOwnedTokenStore(store);
    keys.close();
    broker.close();
  }
}

const mode = process.argv[2];
if (mode === 'capture') {
  reportCapture();
} else if (mode === 'requests') {
  await reportRequests();
} else {
  throw new Error(`Unknown capability child mode: ${String(mode)}`);
}
