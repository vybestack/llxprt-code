import { Session } from './zed-session.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';
import type { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { authenticateZedAgent, initializeZedAgent } from './zed-initialize.js';

import {
  type Config,
  type IContent,
  type ProfileDefinitionListing,
} from '@vybestack/llxprt-code-core';

import type {
  Agent,
  AgentProfileApplication,
} from '@vybestack/llxprt-code-agents';

import type * as acp from '@agentclientprotocol/sdk';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';

import type { IShellToolHost } from '@vybestack/llxprt-code-tools';
import { randomUUID } from 'crypto';
import { buildSessionModes } from './zed-helpers.js';
import {
  buildZedSessionAgent,
  captureZedHostInputs,
  resolveZedHostTrust,
  type ZedHostInputs,
  type ZedSessionProviderInputs,
} from './zed-session-agent.js';
import { resolveSessionTargetDir } from './zed-session-config.js';
import { SessionLifecycle } from './zed-session-lifecycle.js';
import {
  hasRecordedSessionFile,
  nodeChatSessionFileLister,
  resumeAgentHistory,
  toLoadRequestError,
  type ChatSessionFileLister,
} from './zed-session-loader.js';
import {
  projectZedSessionSettings,
  type ZedSessionSettings,
} from './zed-session-ports.js';
import type { TerminalManager } from './zed-terminal-manager.js';
import { createZedTerminalTransport } from './zed-terminal-setup.js';

import type {
  ClientCapabilitiesWithSession,
  CloseSessionRequest,
  CloseSessionResponse,
  DeleteSessionRequest,
  DeleteSessionResponse,
} from './acp-types.js';
import { enableZedSessionRecording } from './zed-agent-setup.js';
import {
  dispatchZedConfigOption,
  zedConfigOptionsForClient,
  zedSessionConfigOptions,
} from './zed-config-options.js';
export { parseZedAuthMethodId } from './zed-helpers.js';

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
  async newSession({
    cwd,
    mcpServers: _mcpServers,
  }: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    try {
      const sessionId = randomUUID();
      const settingsSource = this.createSessionSettings();
      const terminals = this.createTerminals(sessionId, cwd, settingsSource);
      const agent = await this.buildSessionAgent(
        sessionId,
        cwd,
        settingsSource,
        terminals,
      );
      let session: Session;
      try {
        await enableZedSessionRecording(
          () => agent.session.setRecording({ enabled: true }),
          (error) =>
            this.logger.debug(
              () => `Recording failed for ${sessionId}: ${error}`,
            ),
        );
        session = new Session(
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
          this.projectSessionSettings(agent),
          this.connection,
          this.supportsConfigOptions(),
          terminals,
        );
      } catch (error) {
        await agent.dispose().catch(() => undefined);
        await terminals?.settleAll().catch(() => undefined);
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
      this.config.projectChatsDir,
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
    const settingsSource = this.createSessionSettings();
    const terminals = this.createTerminals(sessionId, cwd, settingsSource);
    const agent = await this.buildSessionAgent(
      sessionId,
      cwd,
      settingsSource,
      terminals,
    );
    try {
      const history = await resumeAgentHistory(
        (id) => agent.session.resume(id),
        sessionId,
        this.config.projectChatsDir,
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
        this.projectSessionSettings(agent),
        this.connection,
        this.supportsConfigOptions(),
        terminals,
      );
      return { session, history };
    } catch (error) {
      await agent.dispose().catch(() => undefined);
      await terminals?.settleAll().catch(() => undefined);
      this.logger.debug(() => `loadSession - build/resume failed: ${error}`);
      throw toLoadRequestError(sessionId, error);
    }
  }
  private projectSessionSettings(agent: Agent): ZedSessionSettings {
    return projectZedSessionSettings(
      {
        projectRoot: agent.workspace.getProjectRoot(),
        targetDir: agent.workspace.getWorkingDirectory(),
        maxSessionTurns: this.hostInputs.maxSessionTurns ?? -1,
        debugMode: this.hostInputs.debugMode,
        fileFiltering: {
          respectGitIgnore: this.hostInputs.fileFiltering.respectGitIgnore,
          respectLlxprtIgnore:
            this.hostInputs.fileFiltering.respectLlxprtIgnore,
        },
        recursiveFileSearch:
          this.hostInputs.fileFiltering.enableRecursiveFileSearch,
      },
      agent,
      agent.workspace,
      agent.workspace,
      (listener) => agent.settings.subscribeModelChanges(listener),
    );
  }
  private createTerminals(
    sessionId: string,
    cwd: string | undefined,
    source: SettingsService,
  ): TerminalManager | null {
    if (this.clientCapabilities?.terminal !== true) return null;
    return createZedTerminalTransport(
      sessionId,
      this.connection,
      resolveSessionTargetDir(this.config, cwd),
      this.logger,
      this.config.getInitialSettings()['shell-output-retention-max-bytes'] ??
        source.get('shell-output-retention-max-bytes'),
    );
  }
  private async buildSessionAgent(
    sessionId: string,
    cwd: string | undefined,
    source: SettingsService,
    terminals: TerminalManager | null,
  ): Promise<Agent> {
    const execute: IShellToolHost['executeShellCommand'] | undefined =
      terminals === null
        ? undefined
        : (command, directory, output, signal) =>
            terminals.executeShellCommand(command, directory, output, signal);
    try {
      return await buildZedSessionAgent(
        this.config,
        this.hostInputs,
        this.connection,
        this.clientCapabilities,
        sessionId,
        cwd,
        source,
        this.hostTrust,
        this.providerInputs,
        execute,
      );
    } catch (primary) {
      try {
        await terminals?.settleAll();
      } catch (cleanup) {
        throw new AggregateError(
          [primary, cleanup],
          'ACP session startup and terminal cleanup failed',
        );
      }
      throw primary;
    }
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
