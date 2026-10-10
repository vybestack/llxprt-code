import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { WorkspaceAuthorityComposition } from '../workspace-authority-composition.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { fromConfig, toConfigParameters } from '@vybestack/llxprt-code-agents';
import {
  Config,
  ApprovalMode,
} from '@vybestack/llxprt-code-core/config/config.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
import { createSessionSettingsFixture } from './helpers/session-settings-fixture.js';

function declaration(): Config {
  return new Config(
    toConfigParameters({
      provider: '',
      model: '',
      workingDir: process.cwd(),
      sessionId: 'shared-trust-root',
      folderTrust: true,
      approvalMode: ApprovalMode.AUTO_EDIT,
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpEnabled: false,
      skillsSupport: false,
    }),
  );
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('Production workspace trust authority', () => {
  it('denies immediately through a borrowed authority before transition settlement and preserves that authority after facade retirement', async () => {
    const config = declaration();
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    const gate = deferred();
    const release = trust.subscribeTrustTransition(() => gate.promise);
    const events: boolean[] = [];
    const listener = (trusted: boolean): void => {
      events.push(trusted);
    };
    coreEvents.on(CoreEvent.FolderTrustChanged, listener);
    const agent = await fromConfig({
      config,
      ...createSessionSettingsFixture(config),
      trustPort: trust,
    });
    let denied: Promise<void> | undefined;
    try {
      expect(agent.getApprovalMode()).toBe(ApprovalMode.AUTO_EDIT);
      denied = trust.setTrustedFolderLive(false);
      expect(agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      expect(agent.ide.isTrustedFolder()).toBe(false);
      expect(() => agent.setApprovalMode(ApprovalMode.YOLO)).toThrow(
        'untrusted',
      );
      expect(events).toStrictEqual([false]);
      await trust.setTrustedFolderLive(false);
      expect(events).toStrictEqual([false]);
      gate.resolve();
      await denied;
      await agent.dispose();
      await trust.setTrustedFolderLive(true);
      expect(trust.isTrustedFolder()).toBe(true);
      expect(events).toStrictEqual([false]);
    } finally {
      gate.resolve();
      await denied;
      release();
      await agent.dispose();
      coreEvents.off(CoreEvent.FolderTrustChanged, listener);
      await trust.dispose();
      await config.dispose();
    }
  });
  it('rejects authority initialization after retirement without republishing borrowed trust events', async (): Promise<void> => {
    const config = declaration();
    const trust = new WorkspaceTrustLifecycle();
    const authority = new WorkspaceAuthorityComposition(config, trust);
    const events: boolean[] = [];
    const listener = (trusted: boolean): void => {
      events.push(trusted);
    };
    coreEvents.on(CoreEvent.FolderTrustChanged, listener);
    try {
      await authority.dispose();
      await expect(
        Promise.resolve().then(() => authority.initialize()),
      ).rejects.toThrow('disposed');
      await trust.setTrustedFolderLive(false);
      expect(events).toStrictEqual([]);
    } finally {
      coreEvents.off(CoreEvent.FolderTrustChanged, listener);
      await Promise.allSettled([
        authority.dispose(),
        trust.dispose(),
        config.dispose(),
      ]);
    }
  });

  it('rejects renewed initialization at the public MCP root after its retained initialization retires', async (): Promise<void> => {
    const config = declaration();
    const owner = await McpRuntimeOwner.create(
      createTestOAuthBinding(),
      config,
    );
    try {
      await owner.initialize();
      await owner.dispose();
      await expect(
        Promise.resolve().then(() => owner.initialize()),
      ).rejects.toThrow('stopped');
      await expect(owner.trust.setTrustedFolderLive(false)).rejects.toThrow(
        'disposed',
      );
    } finally {
      await Promise.allSettled([owner.dispose(), config.dispose()]);
    }
  });
});
