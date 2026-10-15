import { Session } from './zed-session.js';
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
  type RuntimeProviderManager,
  type Config,
  type IContent,
  type ProfileDefinitionListing,
} from '@vybestack/llxprt-code-core';

import type {
  Agent,
  AgentProfileApplication,
} from '@vybestack/llxprt-code-agents';

import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type * as acp from '@agentclientprotocol/sdk';

import { randomUUID } from 'crypto';
import { buildSessionModes } from './zed-helpers.js';

import {
  buildProjectedZedSession,
  projectZedSessionSettings,
} from './zed-session-ports.js';

import {
  buildZedSessionAgent,
  captureZedHostInputs,
  resolveZedHostTrust,
  type ZedSessionProviderInputs,
  type ZedSessionAgent,
  type ZedHostInputs,
} from './zed-session-agent.js';

import {
  resumeAgentHistory,
  toLoadRequestError,
  hasRecordedSessionFile,
  nodeChatSessionFileLister,
  type ChatSessionFileLister,
} from './zed-session-loader.js';
import { SessionLifecycle } from './zed-session-lifecycle.js';

import {
  dispatchZedConfigOption,
  zedConfigOptionsForClient,
  zedSessionConfigOptions,
} from './zed-config-options.js';
import { enableZedSessionRecording } from './zed-agent-setup.js';

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
    readonly providerManager: RuntimeProviderManager,
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
  async newSession({
    cwd,
    mcpServers: _mcpServers,
  }: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    try {
      const sessionId = randomUUID();
      const {
        agent,
        config: sessionConfig,
        terminals,
        files,
        disposeConfig,
        settingsOwner,
      } = await this.buildSessionAgent(sessionId, cwd);
      let session: Session;
      try {
        await enableZedSessionRecording(
          () => agent.session.setRecording({ enabled: true }),
          (error) =>
            this.logger.debug(
              () => `Recording failed for ${sessionId}: ${error}`,
            ),
        );
        session = await buildProjectedZedSession(
          agent,
          sessionConfig,
          files,
          settingsOwner.subscribeModelChanges.bind(settingsOwner),
          (settings) =>
            new Session(
              sessionId,
              (input, options) => agent.stream(input, options),
              () => agent.getModel(),
              (model) => agent.setModel(model),
              () => agent.listAvailableModels(),
              () => agent.getProviderContextLimit(),
              () => agent.getApprovalMode(),
              (mode) => agent.setApprovalMode(mode),
              () => agent.getHistory(),
              (options) => agent.compress(options),
              () => agent.dispose(),
              (name) => agent.tools.get(name),
              () => agent.tools.list(),
              agent.tools.respondToConfirmation.bind(agent.tools),
              () => agent.session.getRecordingTitle(),
              (title) => agent.session.recordRecordingTitle(title),
              () => agent.memory.getFilePaths(),
              () => agent.profiles.list(),
              () => agent.tasks.list(),
              settings,
              this.connection,
              this.supportsConfigOptions(),
              terminals,
              disposeConfig,
            ),
          (error) =>
            this.logger.debug(() => `Session cleanup failed: ${error}`),
        );
      } catch (error) {
        await agent.dispose().catch(() => undefined);
        await terminals?.settleAll().catch(() => undefined);
        await disposeConfig();
        throw error;
      }
      return await this.publishNewSession(
        session,
        sessionId,
        () => agent.getModel(),
        () => agent.listAvailableModels(),
        (key) => agent.getEphemeralSetting(key),
        (key, value) => agent.setEphemeralSetting(key, value),
      );
    } catch (error) {
      this.logger.debug(() => `ERROR in newSession: ${error}`);
      throw error;
    }
  }
  private async publishNewSession(
    session: Session,
    sessionId: string,
    readModel: Agent['getModel'],
    listModels: Agent['listAvailableModels'],
    readSetting: Agent['getEphemeralSetting'],
    writeSetting: Agent['setEphemeralSetting'],
  ): Promise<acp.NewSessionResponse> {
    try {
      await session.sendAvailableCommands();
    } catch (error) {
      await session.dispose();
      throw error;
    }
    let configOptions: acp.NewSessionResponse['configOptions'];
    try {
      ({ configOptions } = await zedConfigOptionsForClient(
        this.clientCapabilities,
        {
          getModel: readModel,
          listAvailableModels: listModels,
        },
        { getEphemeralSetting: readSetting, setEphemeralSetting: writeSetting },
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
  private supportsConfigOptions(): boolean {
    return this.clientCapabilities?.session?.configOptions === true;
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
    const {
      agent,
      config: sessionConfig,
      terminals,
      files,
      disposeConfig,
      settingsOwner,
    } = await this.buildSessionAgent(sessionId, cwd);
    try {
      const history = await resumeAgentHistory(
        (id) => agent.session.resume(id),
        sessionId,
        sessionConfig,
        this.sessionFileLister,
      );
      const session = new Session(
        sessionId,
        (input, options) => agent.stream(input, options),
        () => agent.getModel(),
        (model) => agent.setModel(model),
        () => agent.listAvailableModels(),
        () => agent.getProviderContextLimit(),
        () => agent.getApprovalMode(),
        (mode) => agent.setApprovalMode(mode),
        () => agent.getHistory(),
        (options) => agent.compress(options),
        () => agent.dispose(),
        (name) => agent.tools.get(name),
        () => agent.tools.list(),
        agent.tools.respondToConfirmation.bind(agent.tools),
        () => agent.session.getRecordingTitle(),
        (title) => agent.session.recordRecordingTitle(title),
        () => agent.memory.getFilePaths(),
        () => agent.profiles.list(),
        () => agent.tasks.list(),
        projectZedSessionSettings(
          sessionConfig,
          agent,
          files,
          agent.workspace,
          settingsOwner.subscribeModelChanges.bind(settingsOwner),
        ),
        this.connection,
        this.supportsConfigOptions(),
        terminals,
        disposeConfig,
      );
      return { session, history };
    } catch (error) {
      await agent.dispose().catch(() => undefined);
      await terminals?.settleAll().catch(() => undefined);
      await disposeConfig();
      this.logger.debug(() => `loadSession - build/resume failed: ${error}`);
      throw toLoadRequestError(sessionId, error);
    }
  }
  private async buildSessionAgent(
    sessionId: string,
    cwd: string | undefined,
  ): Promise<ZedSessionAgent> {
    return buildZedSessionAgent(
      this.config,
      this.hostInputs,
      this.connection,
      this.clientCapabilities,
      sessionId,
      cwd,
      this.logger,
      this.createSessionSettings(),
      this.hostTrust,
      this.providerInputs,
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
