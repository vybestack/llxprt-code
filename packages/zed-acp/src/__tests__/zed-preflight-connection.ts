/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as acp from '@agentclientprotocol/sdk';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from '../../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../agents/src/core/subagent-cleanup.js';
import { serveZedConnection } from '../runZedIntegration.js';

export interface ZedPreflightConnection {
  /** The foreground preflight route the connection is served from. */
  readonly route: RouteBPreflight;
  readonly root: string;
  readonly client: acp.ClientSideConnection;
  readonly updates: acp.SessionUpdate[];
  /** Ends the connection, then closes the route and removes the root. */
  readonly close: () => Promise<void>;
}

/**
 * One ACP connection served the way the CLI serves it
 * (`handleActivatedZedIntegration`): the post-configuration preflight is both
 * the profile application and the trust port, profiles are listed from it, and
 * each session's settings restore from the preflight's settings snapshot. The
 * root holds the profiles `alpha` and `beta` (models `alpha-model` and
 * `beta-model`). The fake provider is selected by the
 * `LLXPRT_FAKE_RESPONSES` replay seam, which the suite sets with
 * `useFakeResponsesReplay`.
 */
export async function openZedPreflightConnection(
  label: string,
  authority: CredentialAuthority,
): Promise<ZedPreflightConnection> {
  const root = await mkdtemp(join(tmpdir(), 'zed-owner-'));
  let route: RouteBPreflight | undefined;
  let serving: Promise<void> | undefined;
  const fromClient = new TransformStream<Uint8Array, Uint8Array>();
  const fromAgent = new TransformStream<Uint8Array, Uint8Array>();
  const close = (): Promise<void> =>
    runCleanupSteps([
      () => fromClient.writable.close(),
      () => serving,
      () => route?.close(),
      () => rm(root, { recursive: true, force: true }),
    ]);
  try {
    const profiles = new ProfileManager(join(root, 'profiles'));
    for (const name of ['alpha', 'beta'])
      await profiles.saveProfile(name, {
        version: 1,
        provider: 'fake',
        model: name + '-model',
        modelParams: {},
        ephemeralSettings: {},
      });
    const opened = await openRouteBPreflight({
      config: {
        workingDir: root,
        sessionId: label,
        settings: { profileDirectory: join(root, 'profiles') },
      },
      authority,
    });
    route = opened;
    await opened.prepare();
    const preflight = opened.preflight;
    if (!preflight.hasActiveProvider())
      await preflight.setActiveProvider(opened.config.getProvider() ?? 'fake');
    const updates: acp.SessionUpdate[] = [];
    const client = new acp.ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        sessionUpdate: async ({ update }) => {
          updates.push(update);
        },
      }),
      acp.ndJsonStream(fromClient.writable, fromAgent.readable),
    );
    serving = serveZedConnection(
      {
        config: opened.config,
        trustPort: preflight,
        createSessionSettings: () => {
          const session = new SettingsService();
          session.restoreFromStateSnapshot(preflight.captureSettingsSnapshot());
          return session;
        },
        profileApplication: preflight,
        profileDefinitions: { listProfiles: () => preflight.listProfiles() },
        providerInputs: { credentialAuthority: authority },
      },
      acp.ndJsonStream(fromAgent.writable, fromClient.readable),
    );
    await client.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    return { route: opened, root, client, updates, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
