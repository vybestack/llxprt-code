/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  PolicyEngine,
  ApprovalMode,
  type PolicyRule,
  type PolicyDecision,
} from '@vybestack/llxprt-code-policy';
import type { UpdatePolicy } from '@vybestack/llxprt-code-policy';
import type { PolicyDecisionPort } from '@vybestack/llxprt-code-policy/confirmation-bus/message-bus.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { WorkspaceTrustLifecycle } from '../services/workspace-trust-lifecycle.js';
import type { WorkspaceTrustControlPort } from '../services/workspace-trust-ports.js';
import type { Config } from '../config/config.js';
import {
  buildMcpTrustedRules,
  MCP_TRUSTED_POLICY_SOURCE,
  createPolicyUpdater,
  persistPolicyToToml,
} from './config.js';
import {
  prepareUserPolicyRules,
  retainNonUserPolicyRules,
} from './userPolicyStore.js';

export interface WorkspacePolicyOperations {
  getRules(): readonly PolicyRule[];
  reloadUserRules(mode: ApprovalMode): Promise<readonly PolicyRule[]>;
  getDefaultDecision(): PolicyDecision;
  isNonInteractive(): boolean;
}

export interface SessionConfirmationOperations {
  addRule(rule: PolicyRule): void;
  removeRulesBySource(source: string): void;
}

type WorkspacePolicyInputs = Pick<
  Config,
  'getPolicyEngineConfig' | 'getMcpServers'
>;
type SessionPolicyInputs = Pick<Config, 'getApprovalMode' | 'getDebugMode'>;

export class WorkspacePolicyOwner {
  private readonly engine: PolicyEngine;
  private readonly unsubscribe: () => void;
  private stopped = false;
  private admissionClosed = false;
  readonly operations: WorkspacePolicyOperations;

  constructor(
    private readonly inputs: WorkspacePolicyInputs,
    private readonly trust: WorkspaceTrustControlPort,
    borrowedEngine?: PolicyEngine,
  ) {
    this.engine =
      borrowedEngine ?? new PolicyEngine(inputs.getPolicyEngineConfig());
    this.operations = {
      getRules: () => {
        this.assertActive();
        return this.engine.getRules();
      },
      reloadUserRules: async (mode) => {
        this.assertActive();
        const rules = await prepareUserPolicyRules(mode);
        this.assertActive();
        this.engine.replaceRules([
          ...retainNonUserPolicyRules(this.engine.getRules()),
          ...rules,
        ]);
        this.refreshTrust();
        return this.engine.getRules();
      },
      getDefaultDecision: () => {
        this.assertActive();
        return this.engine.getDefaultDecision();
      },
      isNonInteractive: () => {
        this.assertActive();
        return this.engine.isNonInteractive();
      },
    };
    this.refreshTrust();
    this.unsubscribe = trust.subscribeTrustChange(() => this.refreshTrust());
  }

  evaluate(
    toolName: string,
    args: Record<string, unknown>,
    serverName: string | undefined,
    mode: ApprovalMode,
    rules: readonly PolicyRule[],
  ): PolicyDecision {
    this.assertActive();
    if (this.admissionClosed) throw new Error('Workspace policy is disposed');
    return this.engine.evaluate(toolName, args, serverName, {
      mode: this.trust.isTrustedFolder() ? mode : ApprovalMode.DEFAULT,
      rules,
    });
  }

  closeAdmission(): void {
    this.admissionClosed = true;
  }

  dispose(): void {
    if (this.stopped) return;
    this.closeAdmission();
    this.stopped = true;
    this.unsubscribe();
  }

  private readMcpServers = (): ReturnType<Config['getMcpServers']> =>
    this.inputs.getMcpServers();

  bindMcpServers(read: () => ReturnType<Config['getMcpServers']>): () => void {
    this.assertActive();
    const previous = this.readMcpServers;
    this.readMcpServers = read;
    this.refreshTrust();
    return () => {
      this.readMcpServers = previous;
    };
  }

  refreshTrust(): void {
    this.engine.removeRulesBySource(MCP_TRUSTED_POLICY_SOURCE);
    if (this.trust.isTrustedFolder()) {
      for (const rule of buildMcpTrustedRules({
        mcpServers: this.readMcpServers(),
      }))
        this.engine.addRule(rule);
    }
  }

  private assertActive(): void {
    if (this.stopped) throw new Error('Workspace policy is disposed');
  }
}

export class SessionPolicyOwner {
  private rules: readonly PolicyRule[] = [];
  private stopped = false;
  private admissionClosed = false;
  private disposal: Promise<void> | undefined;
  private unsubscribed = false;
  private readonly unsubscribe: () => void;
  private readonly pendingWrites = new Set<Promise<void>>();
  private readonly writeFailures: unknown[] = [];
  readonly decisions: PolicyDecisionPort;
  readonly confirmation: SessionConfirmationOperations;
  readonly messageBus: MessageBus;
  readonly inspection: WorkspacePolicyOperations;

  constructor(
    workspace: WorkspacePolicyOwner,
    inputs: SessionPolicyInputs,
    private readonly borrowedBus?: MessageBus,
    persistPolicy: (
      message: UpdatePolicy,
    ) => Promise<void> = persistPolicyToToml,
  ) {
    this.decisions = {
      evaluate: (toolName, args, serverName) => {
        this.assertActive();
        if (this.admissionClosed) throw new Error('Session policy is disposed');
        return workspace.evaluate(
          toolName,
          args,
          serverName,
          inputs.getApprovalMode(),
          this.rules,
        );
      },
    };
    this.confirmation = {
      addRule: (rule) => {
        this.assertActive();
        if (this.admissionClosed) throw new Error('Session policy is disposed');
        this.rules = [...this.rules, copyRule(rule)];
      },
      removeRulesBySource: (source) => {
        this.assertActive();
        this.rules = this.rules.filter((rule) => rule.source !== source);
      },
    };
    this.inspection = {
      reloadUserRules: async (mode) => {
        this.assertActive();
        const rules = await workspace.operations.reloadUserRules(mode);
        this.assertActive();
        return rules;
      },
      getDefaultDecision: () => {
        this.assertActive();
        return workspace.operations.getDefaultDecision();
      },
      isNonInteractive: () => {
        this.assertActive();
        return workspace.operations.isNonInteractive();
      },
      getRules: () => {
        this.assertActive();
        return [
          ...workspace.operations.getRules(),
          ...this.rules.map(copyRule),
        ].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      },
    };
    this.messageBus =
      borrowedBus ?? new MessageBus(this.decisions, inputs.getDebugMode());
    this.unsubscribe = createPolicyUpdater(this.confirmation, this.messageBus, {
      persist: persistPolicy,
      track: (write) => this.trackWrite(write),
    });
  }

  private trackWrite(write: Promise<void>): void {
    const tracked = write.then(
      () => undefined,
      (error: unknown) => {
        this.writeFailures.push(error);
      },
    );
    this.pendingWrites.add(tracked);
    void tracked.then(() => this.pendingWrites.delete(tracked));
  }

  closeAdmission(): void {
    this.admissionClosed = true;
    if (this.unsubscribed) return;
    this.unsubscribed = true;
    this.unsubscribe();
  }

  dispose(): Promise<void> {
    this.disposal ??= this.performDisposal();
    return this.disposal;
  }

  private async performDisposal(): Promise<void> {
    this.closeAdmission();
    this.stopped = true;
    if (this.borrowedBus === undefined)
      this.messageBus.cancelPendingConfirmations();
    this.rules = [];
    await Promise.all([...this.pendingWrites]);
    if (this.writeFailures.length > 0)
      throw new AggregateError(
        [...this.writeFailures],
        'Session policy persistence failed',
      );
  }

  private assertActive(): void {
    if (this.stopped) throw new Error('Session policy is disposed');
  }
}

export class RuntimePolicyOwner {
  readonly trust: WorkspaceTrustControlPort;
  private readonly trustOwner: WorkspaceTrustLifecycle | undefined;
  readonly workspace: WorkspacePolicyOwner;
  readonly session: SessionPolicyOwner;

  constructor(
    inputs: WorkspacePolicyInputs &
      SessionPolicyInputs &
      Pick<Config, 'initialWorkspaceTrust'>,
    trust?: WorkspaceTrustControlPort,
    borrowedWorkspace?: WorkspacePolicyOwner,
    borrowedBus?: MessageBus,
  ) {
    if (trust === undefined) {
      this.trustOwner = new WorkspaceTrustLifecycle({
        localTrust: inputs.initialWorkspaceTrust,
      });
      this.trust = this.trustOwner;
    } else {
      this.trustOwner = undefined;
      this.trust = trust;
    }
    this.workspace =
      borrowedWorkspace ?? new WorkspacePolicyOwner(inputs, this.trust);
    this.session = new SessionPolicyOwner(this.workspace, inputs, borrowedBus);
    this.ownsWorkspace = borrowedWorkspace === undefined;
  }

  private readonly ownsWorkspace: boolean;

  closeAdmission(): void {
    this.session.closeAdmission();
    if (this.ownsWorkspace) this.workspace.closeAdmission();
  }

  async dispose(): Promise<void> {
    const failures: unknown[] = [];
    const releases: Array<() => Promise<void> | void> = [
      () => this.session.dispose(),
      () => {
        if (this.ownsWorkspace) this.workspace.dispose();
      },
      () => this.trustOwner?.dispose(),
    ];
    for (const release of releases) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Policy owner cleanup failed');
  }
}

function copyRule(rule: PolicyRule): PolicyRule {
  return {
    ...rule,
    modes: rule.modes?.slice(),
    argsPattern: rule.argsPattern
      ? new RegExp(rule.argsPattern.source, rule.argsPattern.flags)
      : undefined,
  };
}
