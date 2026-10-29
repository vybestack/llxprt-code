/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Child process for sandbox-windows-capability-authority.test.ts. It stands in
 * for the CLI that the trusted sandbox entrypoint execs, so it observes exactly
 * what a containerized CLI observes on the Windows delivery path: descriptor 3
 * holding the token, `LLXPRT_CAPABILITY_FD=3`, and no
 * `LLXPRT_CAPABILITY_TOKEN` anywhere in its environment.
 *
 * argv[2] selects the report:
 *   "capture"  — what the consumer left behind, including any rejection.
 *   "requests" — token, key and broker requests through the captured
 *                authority, which only succeed when the token arrived intact.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readSync } from 'node:fs';
import { HostCredentialOwner } from '@vybestack/llxprt-code-providers/auth.js';
import { closeOwnedTokenStore } from '../../../../providers/src/auth/proxy/credential-store-factory.js';

interface TransportEvidence {
  /** The marker the exec'd process actually started with, if any. */
  readonly markerBeforeOwner: string | null;
  /** True when the consumer deleted the marker from `process.env`. */
  readonly markerGone: boolean;
  /** True when descriptor 3 is no longer readable after consumption. */
  readonly descriptorClosed: boolean;
  /** True when `LLXPRT_CAPABILITY_TOKEN` is absent from `process.env`. */
  readonly envTokenAbsent: boolean;
  /**
   * The environment this process was exec'd with, as a local attacker could
   * read it. Linux exposes the initial environ through procfs; elsewhere
   * `ps -Eww` prints the live environment of the named process. The parent
   * searches this dump, so a scrubbed variable cannot hide in a place
   * `process.env` filtering does not cover.
   */
  readonly environmentDump: string;
}

interface CaptureReport extends TransportEvidence {
  readonly error: string | null;
  readonly serialized: string;
}

interface RequestsReport extends TransportEvidence {
  readonly tokenType: string;
  readonly key: string | null;
  readonly brokerKey: unknown;
  readonly serialized: string;
}

function environmentDump(): string {
  try {
    if (existsSync('/proc/self/environ')) {
      return readFileSync('/proc/self/environ', 'utf8');
    }
    return execFileSync('ps', ['-Eww', '-p', String(process.pid)], {
      encoding: 'utf8',
    });
  } catch {
    return '';
  }
}

function descriptorIsClosed(): boolean {
  try {
    readSync(3, Buffer.alloc(1), 0, 1, null);
    return false;
  } catch {
    return true;
  }
}

function transportEvidence(
  markerBeforeOwner: string | null,
  dump: string,
): TransportEvidence {
  return {
    markerBeforeOwner,
    markerGone: process.env.LLXPRT_CAPABILITY_FD === undefined,
    descriptorClosed: descriptorIsClosed(),
    envTokenAbsent: process.env.LLXPRT_CAPABILITY_TOKEN === undefined,
    environmentDump: dump,
  };
}

function reportCapture(): void {
  const markerBeforeOwner = process.env.LLXPRT_CAPABILITY_FD ?? null;
  const dump = environmentDump();
  let error: string | null = null;
  let serialized = 'undefined';
  try {
    const owner = new HostCredentialOwner(process.env);
    serialized = JSON.stringify(owner.authority);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const report: CaptureReport = {
    ...transportEvidence(markerBeforeOwner, dump),
    error,
    serialized,
  };
  process.stdout.write(JSON.stringify(report));
}

async function reportRequests(): Promise<void> {
  const markerBeforeOwner = process.env.LLXPRT_CAPABILITY_FD ?? null;
  const dump = environmentDump();
  const authority = new HostCredentialOwner(process.env).authority;
  const evidence = transportEvidence(markerBeforeOwner, dump);
  // Moving the socket after capture must not rebind the authority, so the
  // requests below only succeed through the captured transport.
  process.env.LLXPRT_CREDENTIAL_SOCKET = '/replacement.sock';
  const store = authority.createTokenStore();
  const keys = authority.createProviderKeyStorage();
  const broker = authority.createGitHubBrokerSocketClient();
  if (broker === null) {
    throw new Error('Captured authority has no broker transport');
  }
  try {
    const token = await store.getToken('test');
    if (token === null) {
      throw new Error('Captured authority returned no token');
    }
    const key = await keys.getKey('primary');
    const response = await broker.request('get_api_key', { name: 'primary' });
    const report: RequestsReport = {
      ...evidence,
      tokenType: token.token_type,
      key,
      brokerKey: (response.data as { key?: unknown } | undefined)?.key,
      serialized: JSON.stringify(authority),
    };
    process.stdout.write(JSON.stringify(report));
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
