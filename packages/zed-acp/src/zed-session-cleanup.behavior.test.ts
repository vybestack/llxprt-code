/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { Config, DebugLogger } from '@vybestack/llxprt-code-core';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  buildZedSessionAgent,
  captureZedHostInputs,
} from './zed-session-agent.js';
import * as acp from '@agentclientprotocol/sdk';
import { ZedAgent } from './zedIntegration.js';
import { unusedProfileApplication } from './test-profile-application.js';
let managers: ProviderManager[] = [];

let host: Config | undefined;
function buildHost(): Config {
  host = new Config({
    sessionId: crypto.randomUUID(),
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    model: 'cleanup-test-model',
  });
  return host;
}
function buildSession(config: Config, trust: WorkspaceTrustLifecycle) {
  const settingsService = new SettingsService();
  const manager = new ProviderManager({
    config,
    settingsService,
  });
  managers.push(manager);
  const connection = new acp.AgentSideConnection(
    (connection) =>
      new ZedAgent(
        config,
        connection,
        unusedProfileApplication,
        manager,
        () => new SettingsService({ sessionSource: settingsService }),
      ),
    acp.ndJsonStream(
      new WritableStream<Uint8Array>(),
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
    ),
  );
  return buildZedSessionAgent(
    config,
    captureZedHostInputs(config),
    connection,
    undefined,
    crypto.randomUUID(),
    process.cwd(),
    new DebugLogger('acp-cleanup-test'),
    settingsService,
    trust,
  );
}

describe('ACP session infrastructure cleanup', () => {
  let trust: WorkspaceTrustLifecycle;
  beforeEach(() => {
    trust = new WorkspaceTrustLifecycle();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const manager of managers) manager.dispose();
    managers = [];
    await trust.dispose();
    await host?.dispose();
    host = undefined;
  });

  it('releases Config subscriptions when the owned manager throws synchronously during disposal', async () => {
    const built = await buildSession(buildHost(), trust);
    let notifications = 0;
    built.settingsOwner.onTelemetrySettingsChange(() => notifications++);
    await built.settingsOwner.updateTelemetrySettings({ enabled: true });
    expect(notifications).toBeGreaterThan(0);

    await built.agent.dispose();
    const failure = new Error('owned manager disposal failed');
    vi.spyOn(ProviderManager.prototype, 'dispose').mockImplementation(() => {
      throw failure;
    });
    await expect(built.disposeConfig()).rejects.toThrow(
      'ACP session infrastructure cleanup failed',
    );
    await expect(
      built.settingsOwner.updateTelemetrySettings({ enabled: false }),
    ).rejects.toThrow('Session settings owner is closed');
    expect(built.settingsOwner.telemetry.isEnabled()).toBe(false);
    expect(notifications).toBe(1);
  });

  it('reports startup and manager cleanup errors together while releasing the failed Config subscriptions', async () => {
    const config = buildHost();
    const startup = new Error('session initialization failed');
    const cleanup = new Error('session manager cleanup failed');
    const failedOwners: SessionSettingsOwner[] = [];
    let notifications = 0;
    vi.spyOn(
      SessionSettingsOwner.prototype,
      'startTelemetry',
    ).mockImplementation(async function (this: SessionSettingsOwner) {
      failedOwners.push(this);
      this.onTelemetrySettingsChange(() => notifications++);
      await this.updateTelemetrySettings({ enabled: true });
      throw startup;
    });
    vi.spyOn(ProviderManager.prototype, 'dispose').mockImplementation(() => {
      throw cleanup;
    });
    let reported: unknown;
    try {
      await buildSession(config, trust);
    } catch (error) {
      reported = error;
    }
    if (!(reported instanceof AggregateError))
      throw new Error('Expected aggregated startup and cleanup failure');
    expect(reported.errors[0]).toBe(startup);
    const infrastructure = reported.errors[1];
    if (!(infrastructure instanceof AggregateError))
      throw new Error('Expected manager infrastructure error');
    expect(infrastructure.errors).toContain(cleanup);
    const failedOwner = failedOwners.at(0);
    if (!failedOwner) throw new Error('Session telemetry was not initialized');
    await expect(
      failedOwner.updateTelemetrySettings({ enabled: false }),
    ).rejects.toThrow('Session settings owner is closed');
    expect(failedOwner.telemetry.isEnabled()).toBe(false);
    expect(notifications).toBe(1);
  });
});
