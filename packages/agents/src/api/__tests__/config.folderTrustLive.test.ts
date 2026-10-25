/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import {
  Config,
  ApprovalMode,
} from '@vybestack/llxprt-code-core/config/config.js';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
import { ideContext } from '@vybestack/llxprt-code-ide-integration';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';

describe('Workspace trust runtime composition', () => {
  const baseParams: ConfigParameters = {
    sessionId: 'test',
    targetDir: '.',
    debugMode: false,
    model: 'test-model',
    cwd: '.',
  };

  const workspaces: RouteAAgent[] = [];
  async function workspace(trustedFolder: boolean) {
    const route = await openRouteAAgent({
      config: {
        sessionId: baseParams.sessionId,
        provider: '',
        model: '',
        skillsSupport: false,
        mcpEnabled: false,
        telemetry: { enabled: false },
        folderTrust: trustedFolder,
      },
      intent: {},
    });
    workspaces.push(route);
    return { agent: route.agent };
  }
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((route) => route.close()));
  });

  describe('Config.setTrustedFolderLive', () => {
    let emitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      ideContext.clearIdeContext();
      emitSpy = vi.spyOn(coreEvents, 'emitFolderTrustChanged');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('updates standalone local trust before root adoption without publishing a frontend transition', async () => {
      const config = new Config({ ...baseParams, trustedFolder: false });
      const trust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      await trust.setTrustedFolderLive(true);
      expect(config.initialWorkspaceTrust).toBe(false);
      expect(trust.isTrustedFolder()).toBe(true);
      await trust.dispose();
      await config.dispose();
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('reflects trusted=true immediately after gaining trust', async () => {
      const { agent } = await workspace(false);
      expect(agent.ide.isTrustedFolder()).toBe(false);

      void agent.ide.setTrustedFolderLive(true);

      expect(agent.ide.isTrustedFolder()).toBe(true);
    });

    it('reflects trusted=false immediately after revoking trust', async () => {
      const { agent } = await workspace(true);
      expect(agent.ide.isTrustedFolder()).toBe(true);

      void agent.ide.setTrustedFolderLive(false);

      expect(agent.ide.isTrustedFolder()).toBe(false);
    });

    it('emits FolderTrustChanged(true) when trust is gained', async () => {
      const { agent } = await workspace(false);

      void agent.ide.setTrustedFolderLive(true);

      expect(emitSpy).toHaveBeenCalledWith(true);
    });

    it('emits FolderTrustChanged(false) when trust is revoked', async () => {
      const { agent } = await workspace(true);

      void agent.ide.setTrustedFolderLive(false);

      expect(emitSpy).toHaveBeenCalledWith(false);
    });

    it('does not emit when the effective value does not change', async () => {
      const { agent } = await workspace(true);

      void agent.ide.setTrustedFolderLive(true);

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('does not emit on no-op in untrusted state either', async () => {
      const { agent } = await workspace(false);

      void agent.ide.setTrustedFolderLive(false);

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('allows setApprovalMode(YOLO) after gaining trust live', async () => {
      const { agent } = await workspace(false);
      expect(() => agent.setApprovalMode(ApprovalMode.YOLO)).toThrow(
        'Cannot enable privileged approval modes in an untrusted folder.',
      );

      void agent.ide.setTrustedFolderLive(true);

      expect(() => agent.setApprovalMode(ApprovalMode.YOLO)).not.toThrow();
    });

    it('blocks setApprovalMode(YOLO) after revoking trust live', async () => {
      const { agent } = await workspace(true);
      agent.setApprovalMode(ApprovalMode.YOLO);

      void agent.ide.setTrustedFolderLive(false);

      expect(() => agent.setApprovalMode(ApprovalMode.YOLO)).toThrow(
        'Cannot enable privileged approval modes in an untrusted folder.',
      );
    });

    it('delivers the event to a real listener on a trust transition', async () => {
      const received: boolean[] = [];
      const listener = (trusted: boolean) => {
        received.push(trusted);
      };
      coreEvents.on(CoreEvent.FolderTrustChanged, listener);

      try {
        const { agent } = await workspace(false);
        void agent.ide.setTrustedFolderLive(true);

        expect(received).toStrictEqual([true]);
      } finally {
        coreEvents.off(CoreEvent.FolderTrustChanged, listener);
      }
    });

    describe('synchronous approval-mode downgrade on revoke', () => {
      it('downgrades YOLO to DEFAULT synchronously when trust is revoked', async () => {
        const { agent } = await workspace(true);
        agent.setApprovalMode(ApprovalMode.YOLO);
        expect(agent.getApprovalMode()).toBe(ApprovalMode.YOLO);

        void agent.ide.setTrustedFolderLive(false);

        expect(agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      });

      it('downgrades AUTO_EDIT to DEFAULT synchronously when trust is revoked', async () => {
        const { agent } = await workspace(true);
        agent.setApprovalMode(ApprovalMode.AUTO_EDIT);
        expect(agent.getApprovalMode()).toBe(ApprovalMode.AUTO_EDIT);

        void agent.ide.setTrustedFolderLive(false);

        expect(agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      });

      it('leaves DEFAULT unchanged when trust is revoked', async () => {
        const { agent } = await workspace(true);
        agent.setApprovalMode(ApprovalMode.DEFAULT);

        void agent.ide.setTrustedFolderLive(false);

        expect(agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      });

      it('does not change approval mode when trust is gained', async () => {
        const { agent } = await workspace(false);
        agent.setApprovalMode(ApprovalMode.DEFAULT);

        void agent.ide.setTrustedFolderLive(true);

        expect(agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      });
    });

    describe('multi-Config isolation', () => {
      it('revoking trust on config A does not affect config B approval mode', async () => {
        const configA = await workspace(true);
        const configB = await workspace(true);
        configA.agent.setApprovalMode(ApprovalMode.YOLO);
        configB.agent.setApprovalMode(ApprovalMode.YOLO);

        void configA.agent.ide.setTrustedFolderLive(false);

        expect(configA.agent.ide.isTrustedFolder()).toBe(false);
        expect(configA.agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
        expect(configB.agent.ide.isTrustedFolder()).toBe(true);
        expect(configB.agent.getApprovalMode()).toBe(ApprovalMode.YOLO);
      });

      it('gaining trust on config A does not change config B trusted state', async () => {
        const configA = await workspace(false);
        const configB = await workspace(false);

        void configA.agent.ide.setTrustedFolderLive(true);

        expect(configA.agent.ide.isTrustedFolder()).toBe(true);
        expect(configB.agent.ide.isTrustedFolder()).toBe(false);
      });
    });
  });
});
