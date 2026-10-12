/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { describe, it, expect, spyOn } from 'bun:test';
import fs from 'node:fs/promises';
import type { OpenMode, ObjectEncodingOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { Config } from '../config/config.js';
import {
  PolicyEngine,
  PolicyDecision,
  ApprovalMode,
  MessageBusType,
  ConfirmationOutcome,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-policy';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { WorkspacePolicyOwner, SessionPolicyOwner } from './policy-owner.js';

function fixture(): {
  config: Config;
  trust: WorkspaceTrustLifecycle;
  workspace: WorkspacePolicyOwner;
} {
  const config = new Config({
    sessionId: 'same-label',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test',
    trustedFolder: true,
    policyEngineConfig: {
      rules: [
        {
          toolName: 'write_file',
          decision: PolicyDecision.ALLOW,
          modes: [ApprovalMode.AUTO_EDIT],
          priority: 1,
        },
      ],
    },
  });
  const trust = new WorkspaceTrustLifecycle({
    localTrust: config.initialWorkspaceTrust,
  });
  return { config, trust, workspace: new WorkspacePolicyOwner(config, trust) };
}

describe('Explicit policy owner boundaries', () => {
  it('keeps Config declarative and observes mode changes on each bus decision', async () => {
    const { config, workspace } = fixture();
    const session = new SessionPolicyOwner(workspace, config);
    expect('getPolicyEngine' in config).toBe(false);
    expect(session.decisions.evaluate('write_file', {})).toBe(
      PolicyDecision.ASK_USER,
    );
    config.setApprovalMode(ApprovalMode.AUTO_EDIT);
    expect(
      await session.messageBus.requestConfirmation({ name: 'write_file' }, {}),
    ).toBe(true);
    config.setApprovalMode(ApprovalMode.DEFAULT);
    expect(session.decisions.evaluate('write_file', {})).toBe(
      PolicyDecision.ASK_USER,
    );
    await session.dispose();
    workspace.dispose();
  });

  it('isolates concurrent grants and disposal even when workspace and labels are shared', async () => {
    const { config, workspace } = fixture();
    const first = new SessionPolicyOwner(workspace, config);
    const second = new SessionPolicyOwner(workspace, config);
    first.confirmation.addRule({
      toolName: 'write_file',
      decision: PolicyDecision.ALLOW,
      priority: 2.95,
    });
    expect(first.decisions.evaluate('write_file', {})).toBe(
      PolicyDecision.ALLOW,
    );
    expect(second.decisions.evaluate('write_file', {})).toBe(
      PolicyDecision.ASK_USER,
    );
    await first.dispose();
    expect(() => first.decisions.evaluate('write_file', {})).toThrow(
      'Session policy is disposed',
    );
    expect(second.decisions.evaluate('write_file', {})).toBe(
      PolicyDecision.ASK_USER,
    );
    await second.dispose();
    workspace.dispose();
  });

  it('retains a borrowed engine identity and reads caller rule changes without taking its lifetime', async () => {
    const { config } = fixture();
    const engine = new PolicyEngine();
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    const workspace = new WorkspacePolicyOwner(config, trust, engine);
    const session = new SessionPolicyOwner(workspace, config);
    engine.addRule({
      toolName: 'write_file',
      decision: PolicyDecision.DENY,
      priority: 3,
    });
    session.confirmation.addRule({
      toolName: 'write_file',
      decision: PolicyDecision.ALLOW,
      priority: 2.95,
    });
    config.setApprovalMode(ApprovalMode.YOLO);
    expect(session.decisions.evaluate('write_file', {})).toBe(
      PolicyDecision.DENY,
    );
    await session.dispose();
    workspace.dispose();
    expect(engine.evaluate('write_file', {})).toBe(PolicyDecision.DENY);
  });
  it('withdraws trusted workspace rules synchronously from both active sessions', async () => {
    const { config, workspace: unused } = fixture();
    unused.dispose();
    config.setMcpServers({ shared: { trust: true } });
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    const workspace = new WorkspacePolicyOwner(config, trust);
    const first = new SessionPolicyOwner(workspace, config);
    const second = new SessionPolicyOwner(workspace, config);
    expect(first.decisions.evaluate('shared__read', {}, 'shared')).toBe(
      PolicyDecision.ALLOW,
    );
    void trust.setTrustedFolderLive(false);
    expect(first.decisions.evaluate('shared__read', {}, 'shared')).toBe(
      PolicyDecision.ASK_USER,
    );
    expect(second.decisions.evaluate('shared__read', {}, 'shared')).toBe(
      PolicyDecision.ASK_USER,
    );
    await first.dispose();
    await second.dispose();
    workspace.dispose();
  });

  it('settles a pending ask on session disposal without cancelling a sibling ask', async () => {
    const { config, workspace } = fixture();
    const first = new SessionPolicyOwner(workspace, config);
    const second = new SessionPolicyOwner(workspace, config);
    let siblingCorrelation = '';
    second.messageBus.subscribe(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (message: ToolConfirmationRequest) => {
        siblingCorrelation = message.correlationId;
      },
    );
    const pending = first.messageBus.requestConfirmation(
      { name: 'write_file' },
      {},
    );
    const sibling = second.messageBus.requestConfirmation(
      { name: 'write_file' },
      {},
    );
    await first.dispose();
    await expect(pending).resolves.toBe(false);
    second.messageBus.respondToConfirmation(
      siblingCorrelation,
      ConfirmationOutcome.ProceedOnce,
    );
    await expect(sibling).resolves.toBe(true);
    await second.dispose();
    workspace.dispose();
  });
});

async function gatedPolicyReload(
  run: (gate: { entered: Promise<void>; release(): void }) => Promise<void>,
): Promise<void> {
  const directory = await fs.mkdtemp(join(tmpdir(), 'policy-reload-'));
  const policies = join(directory, 'policies');
  await fs.mkdir(policies);
  await fs.writeFile(
    join(policies, 'new.toml'),
    '[[rule]]\ntoolName = "new-tool"\ndecision = "deny"\npriority = 100\n',
  );
  const storage = spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(
    policies,
  );
  let release!: () => void;
  let enter!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const read = fs.readFile;
  type ReadPath = Parameters<typeof fs.readFile>[0];
  type ReadOptions = Parameters<typeof fs.readFile>[1];
  function gatedRead(
    path: ReadPath,
    options?: { encoding?: null; flag?: OpenMode; signal?: AbortSignal } | null,
  ): Promise<Buffer<ArrayBuffer>>;
  function gatedRead(
    path: ReadPath,
    options:
      | BufferEncoding
      | { encoding: BufferEncoding; flag?: OpenMode; signal?: AbortSignal },
  ): Promise<string>;
  function gatedRead(
    path: ReadPath,
    options?:
      | BufferEncoding
      | (ObjectEncodingOptions & { flag?: OpenMode; signal?: AbortSignal })
      | null,
  ): Promise<string | Buffer<ArrayBuffer>>;
  async function gatedRead(
    path: ReadPath,
    options?: ReadOptions,
  ): Promise<string | Buffer<ArrayBuffer>> {
    if (String(path).endsWith('new.toml')) {
      enter();
      await gate;
    }
    return read(path, options);
  }
  const reading = spyOn(fs, 'readFile').mockImplementation(gatedRead);
  try {
    await run({ entered, release });
  } finally {
    release();
    reading.mockRestore();
    storage.mockRestore();
    await fs.rm(directory, { recursive: true, force: true });
  }
}

describe('Policy owner lifetime and mutable rule data', () => {
  it('does not publish an accepted reload into a borrowed engine after workspace closing', async () => {
    await gatedPolicyReload(async ({ entered, release }) => {
      const { config, workspace: unused } = fixture();
      unused.dispose();
      const engine = new PolicyEngine();
      const trust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      const workspace = new WorkspacePolicyOwner(config, trust, engine);
      const reload = workspace.operations.reloadUserRules(ApprovalMode.DEFAULT);
      void reload.catch(() => undefined);
      await entered;
      workspace.dispose();
      release();
      await expect(reload).rejects.toThrow('Workspace policy is disposed');
      expect(engine.evaluate('new-tool', {})).toBe(PolicyDecision.ASK_USER);
    });
  });

  it('preserves new host denies and immediate trust withdrawal while a reload is reading', async () => {
    await gatedPolicyReload(async ({ entered, release }) => {
      const { config, workspace: unused } = fixture();
      unused.dispose();
      config.setMcpServers({ shared: { trust: true } });
      const engine = new PolicyEngine();
      const trust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      const workspace = new WorkspacePolicyOwner(config, trust, engine);
      const session = new SessionPolicyOwner(workspace, config);
      const reload = workspace.operations.reloadUserRules(ApprovalMode.DEFAULT);
      try {
        await entered;
        engine.addRule({
          toolName: 'write_file',
          decision: PolicyDecision.DENY,
          priority: 3,
        });
        await trust.setTrustedFolderLive(false);
        expect(session.decisions.evaluate('shared__read', {}, 'shared')).toBe(
          PolicyDecision.ASK_USER,
        );
        expect(session.decisions.evaluate('write_file', {})).toBe(
          PolicyDecision.DENY,
        );
        release();
        await reload;
        expect(session.decisions.evaluate('shared__read', {}, 'shared')).toBe(
          PolicyDecision.ASK_USER,
        );
        expect(session.decisions.evaluate('write_file', {})).toBe(
          PolicyDecision.DENY,
        );
        expect(session.decisions.evaluate('new-tool', {})).toBe(
          PolicyDecision.DENY,
        );
      } finally {
        release();
        await reload;
        await session.dispose();
        workspace.dispose();
      }
    });
  });

  it('rejects every retained reader and reload port after session disposal', async () => {
    const { config, workspace } = fixture();
    const session = new SessionPolicyOwner(workspace, config);
    await session.dispose();
    try {
      expect(() => session.inspection.getRules()).toThrow(
        'Session policy is disposed',
      );
      expect(() => session.inspection.getDefaultDecision()).toThrow(
        'Session policy is disposed',
      );
      expect(() => session.inspection.isNonInteractive()).toThrow(
        'Session policy is disposed',
      );
      await expect(
        session.inspection.reloadUserRules(ApprovalMode.DEFAULT),
      ).rejects.toThrow('Session policy is disposed');
      workspace.dispose();
      expect(() => workspace.operations.getDefaultDecision()).toThrow(
        'Workspace policy is disposed',
      );
      expect(() => workspace.operations.isNonInteractive()).toThrow(
        'Workspace policy is disposed',
      );
    } finally {
      workspace.dispose();
    }
  });

  it('isolates input and inspected regex state from owned session and workspace evaluations', async () => {
    const { config, workspace: unused } = fixture();
    unused.dispose();
    const pattern = /needle/g;
    const engine = new PolicyEngine({
      rules: [
        {
          toolName: 'host',
          argsPattern: pattern,
          decision: PolicyDecision.ALLOW,
        },
      ],
    });
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    const workspace = new WorkspacePolicyOwner(config, trust, engine);
    const session = new SessionPolicyOwner(workspace, config);
    const grantPattern = /needle/g;
    session.confirmation.addRule({
      toolName: 'grant',
      argsPattern: grantPattern,
      decision: PolicyDecision.ALLOW,
    });
    try {
      pattern.lastIndex = 100;
      grantPattern.lastIndex = 100;
      for (const rule of session.inspection.getRules())
        if (rule.argsPattern) rule.argsPattern.lastIndex = 100;
      expect(session.decisions.evaluate('host', { text: 'needle' })).toBe(
        PolicyDecision.ALLOW,
      );
      expect(session.decisions.evaluate('grant', { text: 'needle' })).toBe(
        PolicyDecision.ALLOW,
      );
      expect(session.decisions.evaluate('host', { text: 'needle' })).toBe(
        PolicyDecision.ALLOW,
      );
      expect(session.decisions.evaluate('grant', { text: 'needle' })).toBe(
        PolicyDecision.ALLOW,
      );
      expect(pattern.lastIndex).toBe(100);
    } finally {
      await session.dispose();
      workspace.dispose();
    }
  });
});

describe('Session policy persistence lifetime', () => {
  function heldPersistence(): {
    persist: (message: { toolName?: string }) => Promise<void>;
    started: Promise<void>;
    finish: (error?: Error) => void;
    calls: string[];
  } {
    const calls: string[] = [];
    let started = (): void => {};
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish = (_error?: Error): void => {};
    const persist = (message: { toolName?: string }): Promise<void> => {
      calls.push(message.toolName ?? '');
      started();
      return new Promise<void>((resolve, reject) => {
        finish = (error) => (error ? reject(error) : resolve());
      });
    };
    return {
      persist,
      started: startedPromise,
      finish: (error) => finish(error),
      calls,
    };
  }

  it('joins a held persistence write and reports its failure on disposal', async () => {
    const { config, workspace } = fixture();
    const held = heldPersistence();
    const session = new SessionPolicyOwner(
      workspace,
      config,
      undefined,
      held.persist,
    );
    session.messageBus.publish({
      type: MessageBusType.UPDATE_POLICY,
      toolName: 'write_file',
      persist: true,
    });
    await held.started;
    let settled = false;
    const disposal = session.dispose().then(
      () => 'resolved',
      (error: unknown) => error,
    );
    void disposal.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    const failure = new Error('disk full');
    held.finish(failure);
    const reported = await disposal;
    expect(reported).toBeInstanceOf(AggregateError);
    if (!(reported instanceof AggregateError))
      throw new Error('Disposal did not reject');
    expect(reported.errors).toStrictEqual([failure]);
    workspace.dispose();
  });

  it('rejects direct rule grants from a retained writer once admission closes', async () => {
    const { config, workspace } = fixture();
    const session = new SessionPolicyOwner(workspace, config);
    const grant = {
      toolName: 'shell',
      decision: PolicyDecision.ALLOW,
      priority: 2.95,
      source: 'Dynamic (Confirmed)',
    };
    const writer = session.confirmation;

    writer.addRule(grant);
    expect(
      session.inspection.getRules().filter((rule) => rule.toolName === 'shell'),
    ).toHaveLength(1);

    session.closeAdmission();

    expect(() => writer.addRule({ ...grant, toolName: 'late_tool' })).toThrow(
      'Session policy is disposed',
    );
    expect(
      session.inspection
        .getRules()
        .filter((rule) => rule.toolName === 'late_tool'),
    ).toHaveLength(0);
    await session.dispose();
    workspace.dispose();
  });

  it('stops admitting policy updates once admission closes while keeping a borrowed bus usable', async () => {
    const { config, workspace } = fixture();
    const held = heldPersistence();
    const bus = new MessageBus({ evaluate: () => PolicyDecision.ASK_USER });
    const session = new SessionPolicyOwner(
      workspace,
      config,
      bus,
      held.persist,
    );
    session.closeAdmission();
    bus.publish({
      type: MessageBusType.UPDATE_POLICY,
      toolName: 'write_file',
      persist: true,
    });
    await Promise.resolve();
    expect(held.calls).toStrictEqual([]);
    await session.dispose();
    const requests: string[] = [];
    bus.subscribe(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (message: ToolConfirmationRequest) => {
        requests.push(message.correlationId);
      },
    );
    const pending = bus.requestConfirmation({ name: 'write_file' }, {});
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(requests).toHaveLength(1);
    bus.respondToConfirmation(requests[0], ConfirmationOutcome.ProceedOnce);
    await expect(pending).resolves.toBe(true);
    workspace.dispose();
  });
});
