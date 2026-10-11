/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceIdeOwner } from '../services/workspace-ide-owner.js';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';
import { WorkspaceTrustLifecycle } from '../services/workspace-trust-lifecycle.js';

import { afterEach as disposeOwnedPolicies } from 'bun:test';
import {
  RuntimePolicyOwner,
  WorkspacePolicyOwner,
} from '../policy/policy-owner.js';
import { PolicyEngine } from '../policy/policy-engine.js';

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { ConfigParameters } from './config.js';
import { Config, ApprovalMode } from './config.js';
import { coreEvents, CoreEvent } from '../utils/events.js';
import { PolicyDecision } from '../policy/types.js';
import { ideContext } from '@vybestack/llxprt-code-ide-integration';

describe('Workspace trust runtime composition', () => {
  const baseParams: ConfigParameters = {
    sessionId: 'test',
    targetDir: '.',
    debugMode: false,
    model: 'test-model',
    cwd: '.',
  };

  const workspaces: Array<{ dispose(): Promise<void> }> = [];
  async function workspace(params: ConfigParameters) {
    const config = new Config({
      ...params,
      provider: '',
      model: '',
      skillsSupport: false,
      mcpEnabled: false,
      telemetry: { enabled: false },
    });
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
      ideTrust: ideContext.getIdeContext()?.workspaceState?.isTrusted,
    });
    const settingsService = new SettingsService();
    const settingsOwner = new SessionSettingsOwner(settingsService);
    settingsOwner.initializeProviderSelection(
      config.getProvider(),
      config.getModel(),
    );
    const ide = new WorkspaceIdeOwner(config, trust, trust);
    const agent = await fromConfig({
      config,
      settingsService,
      settingsOwner,
      trustPort: trust,
      idePort: ide,
    });
    workspaces.push({
      dispose: async () => {
        await agent.dispose();
        await ide.dispose();
        await trust.dispose();
        await settingsOwner.dispose();
        await config.dispose();
      },
    });
    return { config, trust, agent };
  }
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((root) => root.dispose()));
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
      const { agent } = await workspace({
        ...baseParams,
        trustedFolder: false,
      });
      expect(agent.ide.isTrustedFolder()).toBe(false);

      void agent.ide.setTrustedFolderLive(true);

      expect(agent.ide.isTrustedFolder()).toBe(true);
    });

    it('reflects trusted=false immediately after revoking trust', async () => {
      const { agent } = await workspace({
        ...baseParams,
        trustedFolder: true,
      });
      expect(agent.ide.isTrustedFolder()).toBe(true);

      void agent.ide.setTrustedFolderLive(false);

      expect(agent.ide.isTrustedFolder()).toBe(false);
    });

    it('emits FolderTrustChanged(true) when trust is gained', async () => {
      const { agent } = await workspace({
        ...baseParams,
        trustedFolder: false,
      });

      void agent.ide.setTrustedFolderLive(true);

      expect(emitSpy).toHaveBeenCalledWith(true);
    });

    it('emits FolderTrustChanged(false) when trust is revoked', async () => {
      const { agent } = await workspace({
        ...baseParams,
        trustedFolder: true,
      });

      void agent.ide.setTrustedFolderLive(false);

      expect(emitSpy).toHaveBeenCalledWith(false);
    });

    it('does not emit when the effective value does not change', async () => {
      const { agent } = await workspace({
        ...baseParams,
        trustedFolder: true,
      });

      void agent.ide.setTrustedFolderLive(true);

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('does not emit on no-op in untrusted state either', async () => {
      const { agent } = await workspace({
        ...baseParams,
        trustedFolder: false,
      });

      void agent.ide.setTrustedFolderLive(false);

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('preserves IDE trust precedence: setter is a no-op when IDE says trusted', async () => {
      vi.spyOn(ideContext, 'getIdeContext').mockReturnValue({
        workspaceState: { isTrusted: true },
      });

      const { agent } = await workspace({
        ...baseParams,
        trustedFolder: false,
      });

      void agent.ide.setTrustedFolderLive(false);

      expect(agent.ide.isTrustedFolder()).toBe(true);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('preserves IDE trust precedence when the IDE says untrusted', async () => {
      vi.spyOn(ideContext, 'getIdeContext').mockReturnValue({
        workspaceState: { isTrusted: false },
      });

      const { agent } = await workspace({
        ...baseParams,
        trustedFolder: true,
      });

      void agent.ide.setTrustedFolderLive(true);

      expect(agent.ide.isTrustedFolder()).toBe(false);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('allows setApprovalMode(YOLO) after gaining trust live', async () => {
      const { agent } = await workspace({
        ...baseParams,
        trustedFolder: false,
      });
      expect(() => agent.setApprovalMode(ApprovalMode.YOLO)).toThrow(
        'Cannot enable privileged approval modes in an untrusted folder.',
      );

      void agent.ide.setTrustedFolderLive(true);

      expect(() => agent.setApprovalMode(ApprovalMode.YOLO)).not.toThrow();
    });

    it('blocks setApprovalMode(YOLO) after revoking trust live', async () => {
      const { agent } = await workspace({
        ...baseParams,
        trustedFolder: true,
      });
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
        const { agent } = await workspace({
          ...baseParams,
          trustedFolder: false,
        });
        void agent.ide.setTrustedFolderLive(true);

        expect(received).toStrictEqual([true]);
      } finally {
        coreEvents.off(CoreEvent.FolderTrustChanged, listener);
      }
    });

    describe('synchronous approval-mode downgrade on revoke', () => {
      it('downgrades YOLO to DEFAULT synchronously when trust is revoked', async () => {
        const { agent } = await workspace({
          ...baseParams,
          trustedFolder: true,
        });
        agent.setApprovalMode(ApprovalMode.YOLO);
        expect(agent.getApprovalMode()).toBe(ApprovalMode.YOLO);

        void agent.ide.setTrustedFolderLive(false);

        expect(agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      });

      it('downgrades AUTO_EDIT to DEFAULT synchronously when trust is revoked', async () => {
        const { agent } = await workspace({
          ...baseParams,
          trustedFolder: true,
        });
        agent.setApprovalMode(ApprovalMode.AUTO_EDIT);
        expect(agent.getApprovalMode()).toBe(ApprovalMode.AUTO_EDIT);

        void agent.ide.setTrustedFolderLive(false);

        expect(agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      });

      it('leaves DEFAULT unchanged when trust is revoked', async () => {
        const { agent } = await workspace({
          ...baseParams,
          trustedFolder: true,
        });
        agent.setApprovalMode(ApprovalMode.DEFAULT);

        void agent.ide.setTrustedFolderLive(false);

        expect(agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      });

      it('does not change approval mode when trust is gained', async () => {
        const { agent } = await workspace({
          ...baseParams,
          trustedFolder: false,
        });
        agent.setApprovalMode(ApprovalMode.DEFAULT);

        void agent.ide.setTrustedFolderLive(true);

        expect(agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      });
    });

    describe('multi-Config isolation', () => {
      it('revoking trust on config A does not affect config B approval mode', async () => {
        const configA = await workspace({
          ...baseParams,
          trustedFolder: true,
        });
        const configB = await workspace({
          ...baseParams,
          trustedFolder: true,
        });
        configA.agent.setApprovalMode(ApprovalMode.YOLO);
        configB.agent.setApprovalMode(ApprovalMode.YOLO);

        void configA.agent.ide.setTrustedFolderLive(false);

        expect(configA.agent.ide.isTrustedFolder()).toBe(false);
        expect(configA.agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
        expect(configB.agent.ide.isTrustedFolder()).toBe(true);
        expect(configB.agent.getApprovalMode()).toBe(ApprovalMode.YOLO);
      });

      it('gaining trust on config A does not change config B trusted state', async () => {
        const configA = await workspace({
          ...baseParams,
          trustedFolder: false,
        });
        const configB = await workspace({
          ...baseParams,
          trustedFolder: false,
        });

        void configA.agent.ide.setTrustedFolderLive(true);

        expect(configA.agent.ide.isTrustedFolder()).toBe(true);
        expect(configB.agent.ide.isTrustedFolder()).toBe(false);
      });
    });

    describe('defense-in-depth policy rule cleanup on revoke', () => {
      it('removes MCP Trusted policy rules when trust is revoked', async () => {
        const { config, trust, agent } = await workspace({
          ...baseParams,
          trustedFolder: true,
        });
        const policyEngine = new PolicyEngine(config.getPolicyEngineConfig());
        const workspacePolicy = new WorkspacePolicyOwner(
          config,
          trust,
          policyEngine,
        );
        ownedPolicies.push(workspacePolicy);
        const policyOwner = new RuntimePolicyOwner(
          config,
          trust,
          workspacePolicy,
        );
        ownedPolicies.push(policyOwner);
        policyEngine.addRule({
          toolName: 'trusted-server__tool',
          decision: PolicyDecision.ALLOW,
          priority: 2.2,
          source: 'Settings (MCP Trusted)',
        });
        policyEngine.addRule({
          toolName: 'user-tool',
          decision: PolicyDecision.DENY,
          priority: 2.9,
          source: 'User Defined',
        });

        void agent.ide.setTrustedFolderLive(false);

        expect(
          policyOwner.session.decisions.evaluate(
            'trusted-server__tool',
            {},
            'trusted-server',
          ),
        ).toBe(PolicyDecision.ASK_USER);
        expect(policyOwner.session.decisions.evaluate('user-tool', {})).toBe(
          PolicyDecision.DENY,
        );
      });

      it('rebuilds configured MCP trust rules on gain', async () => {
        const { config, trust, agent } = await workspace({
          ...baseParams,
          trustedFolder: false,
          mcpServers: { 'trusted-server': { trust: true } },
        });
        const policyEngine = new PolicyEngine(config.getPolicyEngineConfig());
        const workspacePolicy = new WorkspacePolicyOwner(
          config,
          trust,
          policyEngine,
        );
        ownedPolicies.push(workspacePolicy);
        const policyOwner = new RuntimePolicyOwner(
          config,
          trust,
          workspacePolicy,
        );
        ownedPolicies.push(policyOwner);
        policyEngine.addRule({
          toolName: 'user-tool',
          decision: PolicyDecision.DENY,
          priority: 2.9,
          source: 'User Defined',
        });

        expect(
          policyOwner.session.decisions.evaluate(
            'trusted-server__tool',
            {},
            'trusted-server',
          ),
        ).toBe(PolicyDecision.ASK_USER);

        void agent.ide.setTrustedFolderLive(true);

        expect(
          policyOwner.session.decisions.evaluate(
            'trusted-server__tool',
            {},
            'trusted-server',
          ),
        ).toBe(PolicyDecision.ALLOW);
        expect(policyOwner.session.decisions.evaluate('user-tool', {})).toBe(
          PolicyDecision.DENY,
        );
      });
    });
  });

  const ownedPolicies: Array<{ dispose(): void | Promise<void> }> = [];
  disposeOwnedPolicies(async () => {
    await Promise.all(ownedPolicies.splice(0).map((owner) => owner.dispose()));
  });
});
