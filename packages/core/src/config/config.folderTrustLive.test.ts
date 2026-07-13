/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConfigParameters } from './config.js';
import { Config, ApprovalMode } from './config.js';
import { coreEvents, CoreEvent } from '../utils/events.js';
import { PolicyDecision } from '../policy/types.js';
import { ideContext } from '@vybestack/llxprt-code-ide-integration';

const baseParams: ConfigParameters = {
  sessionId: 'test',
  targetDir: '.',
  debugMode: false,
  model: 'test-model',
  cwd: '.',
};

describe('Config.setTrustedFolderLive', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ideContext.clearIdeContext();
    emitSpy = vi.spyOn(coreEvents, 'emitFolderTrustChanged');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reflects trusted=true immediately after gaining trust', () => {
    const config = new Config({ ...baseParams, trustedFolder: false });
    expect(config.isTrustedFolder()).toBe(false);

    config.setTrustedFolderLive(true);

    expect(config.isTrustedFolder()).toBe(true);
  });

  it('reflects trusted=false immediately after revoking trust', () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    expect(config.isTrustedFolder()).toBe(true);

    config.setTrustedFolderLive(false);

    expect(config.isTrustedFolder()).toBe(false);
  });

  it('emits FolderTrustChanged(true) when trust is gained', () => {
    const config = new Config({ ...baseParams, trustedFolder: false });

    config.setTrustedFolderLive(true);

    expect(emitSpy).toHaveBeenCalledWith(true);
  });

  it('emits FolderTrustChanged(false) when trust is revoked', () => {
    const config = new Config({ ...baseParams, trustedFolder: true });

    config.setTrustedFolderLive(false);

    expect(emitSpy).toHaveBeenCalledWith(false);
  });

  it('does not emit when the effective value does not change', () => {
    const config = new Config({ ...baseParams, trustedFolder: true });

    config.setTrustedFolderLive(true);

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('does not emit on no-op in untrusted state either', () => {
    const config = new Config({ ...baseParams, trustedFolder: false });

    config.setTrustedFolderLive(false);

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('preserves IDE trust precedence: setter is a no-op when IDE says trusted', () => {
    const ideSpy = vi.spyOn(ideContext, 'getIdeContext').mockReturnValue({
      workspaceState: { isTrusted: true },
    });

    const config = new Config({ ...baseParams, trustedFolder: false });

    config.setTrustedFolderLive(false);

    expect(config.isTrustedFolder()).toBe(true);
    expect(emitSpy).not.toHaveBeenCalled();

    ideSpy.mockRestore();
  });

  it('allows setApprovalMode(YOLO) after gaining trust live', () => {
    const config = new Config({ ...baseParams, trustedFolder: false });
    expect(() => config.setApprovalMode(ApprovalMode.YOLO)).toThrow(
      'Cannot enable privileged approval modes in an untrusted folder.',
    );

    config.setTrustedFolderLive(true);

    expect(() => config.setApprovalMode(ApprovalMode.YOLO)).not.toThrow();
  });

  it('blocks setApprovalMode(YOLO) after revoking trust live', () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    config.setApprovalMode(ApprovalMode.YOLO);

    config.setTrustedFolderLive(false);

    expect(() => config.setApprovalMode(ApprovalMode.YOLO)).toThrow(
      'Cannot enable privileged approval modes in an untrusted folder.',
    );
  });

  it('delivers the event to a real listener on a trust transition', () => {
    const received: boolean[] = [];
    const listener = (trusted: boolean) => {
      received.push(trusted);
    };
    coreEvents.on(CoreEvent.FolderTrustChanged, listener);

    try {
      const config = new Config({ ...baseParams, trustedFolder: false });
      config.setTrustedFolderLive(true);

      expect(received).toStrictEqual([true]);
    } finally {
      coreEvents.off(CoreEvent.FolderTrustChanged, listener);
    }
  });

  describe('synchronous approval-mode downgrade on revoke', () => {
    it('downgrades YOLO to DEFAULT synchronously when trust is revoked', () => {
      const config = new Config({ ...baseParams, trustedFolder: true });
      config.setApprovalMode(ApprovalMode.YOLO);
      expect(config.getApprovalMode()).toBe(ApprovalMode.YOLO);

      config.setTrustedFolderLive(false);

      expect(config.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
    });

    it('downgrades AUTO_EDIT to DEFAULT synchronously when trust is revoked', () => {
      const config = new Config({ ...baseParams, trustedFolder: true });
      config.setApprovalMode(ApprovalMode.AUTO_EDIT);
      expect(config.getApprovalMode()).toBe(ApprovalMode.AUTO_EDIT);

      config.setTrustedFolderLive(false);

      expect(config.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
    });

    it('leaves DEFAULT unchanged when trust is revoked', () => {
      const config = new Config({ ...baseParams, trustedFolder: true });
      config.setApprovalMode(ApprovalMode.DEFAULT);

      config.setTrustedFolderLive(false);

      expect(config.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
    });

    it('does not change approval mode when trust is gained', () => {
      const config = new Config({ ...baseParams, trustedFolder: false });
      config.setApprovalMode(ApprovalMode.DEFAULT);

      config.setTrustedFolderLive(true);

      expect(config.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
    });
  });

  describe('multi-Config isolation', () => {
    it('revoking trust on config A does not affect config B approval mode', () => {
      const configA = new Config({ ...baseParams, trustedFolder: true });
      const configB = new Config({ ...baseParams, trustedFolder: true });
      configA.setApprovalMode(ApprovalMode.YOLO);
      configB.setApprovalMode(ApprovalMode.YOLO);

      configA.setTrustedFolderLive(false);

      expect(configA.isTrustedFolder()).toBe(false);
      expect(configA.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      expect(configB.isTrustedFolder()).toBe(true);
      expect(configB.getApprovalMode()).toBe(ApprovalMode.YOLO);
    });

    it('gaining trust on config A does not change config B trusted state', () => {
      const configA = new Config({ ...baseParams, trustedFolder: false });
      const configB = new Config({ ...baseParams, trustedFolder: false });

      configA.setTrustedFolderLive(true);

      expect(configA.isTrustedFolder()).toBe(true);
      expect(configB.isTrustedFolder()).toBe(false);
    });
  });

  describe('defense-in-depth policy rule cleanup on revoke', () => {
    it('removes MCP Trusted policy rules when trust is revoked', () => {
      const config = new Config({ ...baseParams, trustedFolder: true });
      // Simulate a trust-derived MCP ALLOW rule
      config.getPolicyEngine().addRule({
        toolName: 'trusted-server__tool',
        decision: PolicyDecision.ALLOW,
        priority: 2.2,
        source: 'Settings (MCP Trusted)',
      });
      expect(config.getPolicyEngine().getRules()).toHaveLength(1);

      config.setTrustedFolderLive(false);

      expect(config.getPolicyEngine().getRules()).toHaveLength(0);
    });

    it('rebuilds configured MCP trust rules on gain', () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: false,
        mcpServers: { 'trusted-server': { trust: true } },
      });

      expect(
        config
          .getPolicyEngine()
          .evaluate('trusted-server__tool', {}, 'trusted-server'),
      ).toBe(PolicyDecision.ASK_USER);

      config.setTrustedFolderLive(true);

      expect(
        config
          .getPolicyEngine()
          .evaluate('trusted-server__tool', {}, 'trusted-server'),
      ).toBe(PolicyDecision.ALLOW);
    });
  });
});
