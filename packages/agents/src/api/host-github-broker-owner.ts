/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GitHubBrokerClient } from '@vybestack/llxprt-code-tools';
import type { GitHubReportOperations } from '@vybestack/llxprt-code-tools';
import {
  GITHUB_MUTATING_OPS,
  validateGithubOpParams,
} from '@vybestack/llxprt-code-tools/tools/github-ops.js';

export interface HostGitHubBrokerSelection {
  readonly githubBrokerClient?: GitHubBrokerClient;
  readonly disposeGitHubBroker?: () => Promise<void>;
}

export class HostGitHubBrokerOwner {
  private readonly cancellation = new AbortController();
  private readonly accepted = new Set<Promise<unknown>>();
  private disposal: Promise<void> | undefined;
  private sessionOwnsLifecycle = false;

  transferToSession(): void {
    this.cancellation.signal.throwIfAborted();
    if (this.sessionOwnsLifecycle)
      throw new Error('GitHub report lifetime is already transferred');
    this.sessionOwnsLifecycle = true;
  }

  cleanupFailedConstruction(): Promise<void> {
    return this.sessionOwnsLifecycle ? Promise.resolve() : this.dispose();
  }

  readonly operations: GitHubReportOperations = Object.freeze({
    readReport: (
      op: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
    ) => this.run(false, op, params, signal),
    submitReport: (
      op: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
    ) => this.run(true, op, params, signal),
  });

  constructor(
    private readonly client: GitHubBrokerClient,
    private readonly disposeTransport?: () => Promise<void>,
  ) {}

  private async run(
    write: boolean,
    op: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    this.cancellation.signal.throwIfAborted();
    const validation = validateGithubOpParams(op, params);
    if (validation !== null) throw new Error(validation);
    if (GITHUB_MUTATING_OPS.has(op) !== write)
      throw new Error(
        `GitHub operation '${op}' requires the ${write ? 'read' : 'submit'} report port`,
      );
    const combined = AbortSignal.any([signal, this.cancellation.signal]);
    combined.throwIfAborted();
    const operation = Promise.resolve().then(() => {
      combined.throwIfAborted();
      return this.client.runOperation(op, params, combined);
    });
    this.accepted.add(operation);
    void operation.then(
      () => this.accepted.delete(operation),
      () => this.accepted.delete(operation),
    );
    return operation;
  }

  closeAdmission(): void {
    this.cancellation.abort(new Error('GitHub report admission is closed'));
  }

  dispose(): Promise<void> {
    this.closeAdmission();
    this.disposal ??= Promise.allSettled([...this.accepted]).then(async () => {
      await this.disposeTransport?.();
    });
    return this.disposal;
  }
}

export function assembleHostGitHubBroker(
  selection: HostGitHubBrokerSelection,
): HostGitHubBrokerOwner | undefined {
  if (selection.githubBrokerClient === undefined) {
    if (selection.disposeGitHubBroker !== undefined)
      throw new Error('GitHub transport disposal requires an explicit broker');
    return undefined;
  }
  return new HostGitHubBrokerOwner(
    selection.githubBrokerClient,
    selection.disposeGitHubBroker,
  );
}
