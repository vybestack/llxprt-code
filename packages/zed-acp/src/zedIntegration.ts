import type { Session } from './zed-session.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';
import { authenticateZedAgent, initializeZedAgent } from './zed-initialize.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

import {
  type Config,
  type IContent,
  type ProfileDefinitionListing,
} from '@vybestack/llxprt-code-core';

import type { AgentProfileApplication } from '@vybestack/llxprt-code-agents';

import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type * as acp from '@agentclientprotocol/sdk';

import { randomUUID } from 'crypto';
import { buildSessionModes } from './zed-helpers.js';

import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

import {
  acquireZedSession,
  captureZedHostInputs,
  resolveZedHostTrust,
  type ZedSessionProviderInputs,
  type ZedHostInputs,
} from './zed-session-agent.js';

import {
  toLoadRequestError,
  hasRecordedSessionFile,
  nodeChatSessionFileLister,
  type ChatSessionFileLister,
} from './zed-session-loader.js';
import { SessionLifecycle } from './zed-session-lifecycle.js';

import {
  dispatchZedConfigOption,
  zedSessionConfigOptions,
} from './zed-config-options.js';

import type {
  CloseSessionRequest,
  CloseSessionResponse,
  DeleteSessionRequest,
  DeleteSessionResponse,
  ClientCapabilitiesWithSession,
} from './acp-types.js';
export { parseZedAuthMethodId } from './zed-helpers.js';
export { runZedIntegration } from './runZedIntegration.js';

export class ZedAgent {
  private sessions: Map<string, Session> = new Map();
  private clientCapabilities: ClientCapabilitiesWithSession | undefined;
  private readonly logger = new DebugLogger('llxprt:zed-integration');
  private readonly lifecycle: SessionLifecycle;
  private readonly hostInputs: ZedHostInputs;
  private readonly ownedTrust: WorkspaceTrustLifecycle | undefined;
  private readonly hostTrust: WorkspaceTrustControlPort;
  constructor(
    private config: Config,
    private connection: acp.AgentSideConnection,
    private readonly application: AgentProfileApplication,
    private readonly createSessionSettings: () => SettingsService,
    private readonly sessionFileLister: ChatSessionFileLister = nodeChatSessionFileLister,
    private readonly definitions?: ProfileDefinitionListing,
    hostTrust?: WorkspaceTrustControlPort,
    private readonly providerInputs: ZedSessionProviderInputs = {},
  ) {
    ({ trust: this.hostTrust, owned: this.ownedTrust } = resolveZedHostTrust(
      config,
      hostTrust,
    ));
    this.hostInputs = captureZedHostInputs(config);
    this.lifecycle = new SessionLifecycle(
      config,
      this.sessions,
      (sessionId, cwd) => this.buildAndResumeSession(sessionId, cwd),
      (session) => zedSessionConfigOptions(this.clientCapabilities, session),
    );
  }
  async initialize(
    args: acp.InitializeRequest,
  ): Promise<acp.InitializeResponse> {
    this.clientCapabilities = args.clientCapabilities as
      | ClientCapabilitiesWithSession
      | undefined;
    return initializeZedAgent(this.definitions);
  }
  listSessions(
    params: acp.ListSessionsRequest,
  ): Promise<acp.ListSessionsResponse> {
    return this.lifecycle.list(params);
  }
  authenticate({ methodId }: acp.AuthenticateRequest): Promise<void> {
    return authenticateZedAgent(this.definitions, methodId, this.application);
  }
  async newSession(
    params: acp.NewSessionRequest,
  ): Promise<acp.NewSessionResponse> {
    try {
      const sessionId = randomUUID();
      const { session } = await this.buildSession(sessionId, params.cwd, false);
      return await this.publishNewSession(session, sessionId);
    } catch (error) {
      this.logger.debug(() => `ERROR in newSession: ${error}`);
      throw error;
    }
  }
  private async publishNewSession(
    session: Session,
    sessionId: string,
  ): Promise<acp.NewSessionResponse> {
    try {
      await session.sendAvailableCommands();
    } catch (error) {
      await session.dispose();
      throw error;
    }
    let configOptions: acp.NewSessionResponse['configOptions'];
    try {
      ({ configOptions } = await zedSessionConfigOptions(
        this.clientCapabilities,
        session,
      ));
    } catch (error) {
      await session.dispose();
      throw error;
    }
    this.sessions.set(sessionId, session);
    return {
      sessionId,
      modes: buildSessionModes(session.getApprovalMode()),
      ...(configOptions === undefined ? {} : { configOptions }),
    };
  }
  resumeSession(
    params: acp.ResumeSessionRequest,
  ): Promise<acp.ResumeSessionResponse> {
    return this.lifecycle.resume(params);
  }
  async loadSession(
    params: acp.LoadSessionRequest,
  ): Promise<acp.LoadSessionResponse> {
    return this.lifecycle.runSerialized(params.sessionId, () =>
      this.performLoadSession(params),
    );
  }
  private async performLoadSession(
    params: acp.LoadSessionRequest,
  ): Promise<acp.LoadSessionResponse> {
    const { sessionId } = params;
    const reattached = await this.tryReattachLiveSession(sessionId);
    if (reattached !== null) {
      try {
        await reattached.sendAvailableCommands();
      } catch (error) {
        await this.rollbackSession(sessionId, reattached);
        throw error;
      }
      try {
        return {
          modes: buildSessionModes(reattached.getApprovalMode()),
          ...(await zedSessionConfigOptions(
            this.clientCapabilities,
            reattached,
          )),
        };
      } catch (error) {
        await this.rollbackSession(sessionId, reattached);
        throw error;
      }
    }
    await this.disposePriorSession(sessionId);
    const session = await this.installResumedSession(sessionId, params.cwd);
    try {
      await session.sendAvailableCommands();
    } catch (error) {
      await this.rollbackSession(sessionId, session);
      throw error;
    }
    return {
      modes: buildSessionModes(session.getApprovalMode()),
      ...(await zedSessionConfigOptions(this.clientCapabilities, session)),
    };
  }
  private async tryReattachLiveSession(
    sessionId: string,
  ): Promise<Session | null> {
    const existing = this.sessions.get(sessionId);
    if (existing === undefined) {
      return null;
    }
    const recordingExists = await hasRecordedSessionFile(
      this.config,
      sessionId,
      this.sessionFileLister,
    );
    if (recordingExists) {
      return null;
    }
    this.logger.debug(
      () => `loadSession - re-attaching live session ${sessionId}`,
    );
    try {
      await existing.replayLiveHistory();
      return existing;
    } catch (error) {
      await this.rollbackSession(sessionId, existing);
      throw error;
    }
  }
  private async rollbackSession(
    sessionId: string,
    session: Session,
  ): Promise<void> {
    this.sessions.delete(sessionId);
    await session.dispose().catch(() => undefined);
  }
  private async disposePriorSession(sessionId: string): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) await this.rollbackSession(sessionId, existing);
  }
  private async installResumedSession(
    sessionId: string,
    cwd: string | undefined,
  ): Promise<Session> {
    const { session, history } = await this.buildAndResumeSession(
      sessionId,
      cwd,
    );
    this.sessions.set(sessionId, session);
    try {
      await session.streamHistory(history);
    } catch (error) {
      await this.rollbackSession(sessionId, session);
      this.logger.debug(() => `loadSession - replay failed: ${error}`);
      throw error;
    }
    return session;
  }
  private async buildAndResumeSession(
    sessionId: string,
    cwd: string | undefined,
  ): Promise<{ session: Session; history: readonly IContent[] }> {
    try {
      return await this.buildSession(sessionId, cwd, true);
    } catch (error) {
      this.logger.debug(() => `loadSession - build/resume failed: ${error}`);
      throw toLoadRequestError(sessionId, error);
    }
  }
  private async buildSession(
    sessionId: string,
    cwd: string | undefined,
    resume: boolean,
  ): Promise<{ session: Session; history: readonly IContent[] }> {
    const settings = this.createSessionSettings();
    return acquireZedSession(
      this.config,
      this.hostInputs,
      this.connection,
      this.clientCapabilities,
      sessionId,
      cwd,
      this.logger,
      settings,
      new SessionSettingsOwner(settings),
      this.hostTrust,
      this.providerInputs,
      resume,
      this.sessionFileLister,
    );
  }
  deleteSession(params: DeleteSessionRequest): Promise<DeleteSessionResponse> {
    return this.lifecycle.delete(params);
  }
  closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    return this.lifecycle.close(params);
  }
  setSessionMode(
    params: acp.SetSessionModeRequest,
  ): Promise<acp.SetSessionModeResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    return Promise.resolve(session.setMode(params.modeId));
  }
  setSessionConfigOption(params: acp.SetSessionConfigOptionRequest) {
    return this.lifecycle.runSerialized(params.sessionId, () =>
      dispatchZedConfigOption(this.clientCapabilities, this.sessions, params),
    );
  }
  async cancel({ sessionId }: acp.CancelNotification): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    await session.cancelPendingPrompt();
  }
  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    return session.prompt(params);
  }
  async disposeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    const results = await Promise.allSettled(
      sessions.map((session) => session.dispose()),
    );
    const trust = await Promise.allSettled([this.ownedTrust?.dispose()]);
    const failures = [...results, ...trust].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'ACP workspace disposal failed');
  }
}
