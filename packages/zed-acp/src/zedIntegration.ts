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
import { rethrowZedSessionFailure } from './zed-session-errors.js';
import {
  hasRecordedSessionFile,
  nodeChatSessionFileLister,
  resumeAgentHistory,
  toLoadRequestError,
  type ChatSessionFileLister,
} from './zed-session-loader.js';
import {
  projectZedSessionAgent,
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
  projectZedModelReads,
  projectZedOptionSettings,
  zedConfigOptionsForClient,
  zedSessionConfigOptions,
} from './zed-config-options.js';
export { runZedIntegration } from './runZedIntegration.js';
export { parseZedAuthMethodId } from './zed-helpers.js';
export { Session } from './zed-session.js';

export class ZedAgent {
  private sessions: Map<string, Session> = new Map();
  private closing: Promise<void> | undefined;
  private readonly acceptedWork = new Set<Promise<void>>();
  private readonly unpublishedSessions = new Set<Session>();
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
  initialize(args: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    return this.admitWork(() => {
      this.clientCapabilities = args.clientCapabilities as
        | ClientCapabilitiesWithSession
        | undefined;
      return initializeZedAgent(this.definitions);
    });
  }
  listSessions(
    params: acp.ListSessionsRequest,
  ): Promise<acp.ListSessionsResponse> {
    return this.admitWork(() => this.lifecycle.list(params));
  }
  authenticate({ methodId }: acp.AuthenticateRequest): Promise<void> {
    return this.admitWork(() =>
      authenticateZedAgent(this.definitions, methodId, this.application),
    );
  }
  newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    return this.admitWork(() => this.openSession(params));
  }
  private async openSession({
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
        await enableZedSessionRecording(agent, (error) =>
          this.logger.debug(
            () => `Recording failed for ${sessionId}: ${error}`,
          ),
        );
        session = new Session(
          sessionId,
          projectZedSessionAgent(agent),
          this.projectSessionSettings(agent),
          this.connection,
          this.supportsConfigOptions(),
          terminals,
        );
      } catch (primary) {
        const results = await Promise.allSettled([
          Promise.resolve().then(() => agent.dispose()),
          Promise.resolve().then(() => terminals?.dispose()),
        ]);
        rethrowZedSessionFailure(
          primary,
          results.flatMap((result) =>
            result.status === 'rejected' ? [result.reason] : [],
          ),
        );
      }
      this.unpublishedSessions.add(session);
      if (this.closing !== undefined) {
        await this.releaseSession(session);
        this.assertOpen();
      }
      try {
        await session.sendAvailableCommands();
      } catch (primary) {
        return await this.rejectSession(sessionId, session, primary);
      }
      let configOptions: acp.NewSessionResponse['configOptions'];
      try {
        ({ configOptions } = await zedConfigOptionsForClient(
          this.clientCapabilities,
          projectZedModelReads(agent),
          projectZedOptionSettings(agent),
        ));
      } catch (primary) {
        return await this.rejectSession(sessionId, session, primary);
      }
      if (this.closing !== undefined) {
        await this.releaseSession(session);
        this.assertOpen();
      }
      this.unpublishedSessions.delete(session);
      this.sessions.set(sessionId, session);
      return {
        sessionId,
        modes: buildSessionModes(agent.getApprovalMode()),
        ...(configOptions === undefined ? {} : { configOptions }),
      };
    } catch (error) {
      this.logger.debug(() => `ERROR in newSession: ${error}`);
      throw error;
    }
  }
  resumeSession(
    params: acp.ResumeSessionRequest,
  ): Promise<acp.ResumeSessionResponse> {
    return this.admitWork(() => this.lifecycle.resume(params));
  }
  private supportsConfigOptions(): boolean {
    return this.clientCapabilities?.session?.configOptions === true;
  }
  async loadSession(
    params: acp.LoadSessionRequest,
  ): Promise<acp.LoadSessionResponse> {
    return this.admitWork(() =>
      this.lifecycle.runSerialized(params.sessionId, () =>
        this.performLoadSession(params),
      ),
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
        return this.rejectSession(sessionId, reattached, error);
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
        return this.rejectSession(sessionId, reattached, error);
      }
    }
    await this.disposePriorSession(sessionId);
    const session = await this.installResumedSession(sessionId, params.cwd);
    try {
      await session.sendAvailableCommands();
      return {
        modes: buildSessionModes(session.getApprovalMode()),
        ...(await zedSessionConfigOptions(this.clientCapabilities, session)),
      };
    } catch (error) {
      return this.rejectSession(sessionId, session, error);
    }
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
      return this.rejectSession(sessionId, existing, error);
    }
  }
  private async rollbackSession(
    sessionId: string,
    session: Session,
  ): Promise<void> {
    this.sessions.delete(sessionId);
    await this.releaseSession(session);
  }
  private async releaseSession(session: Session): Promise<void> {
    try {
      await session.dispose();
    } catch (error) {
      if (this.closing === undefined) this.unpublishedSessions.delete(session);
      throw error;
    }
    this.unpublishedSessions.delete(session);
  }
  private async rejectSession(
    sessionId: string,
    session: Session,
    primary: unknown,
  ): Promise<never> {
    this.sessions.delete(sessionId);
    const results = await Promise.allSettled([
      Promise.resolve().then(() => this.releaseSession(session)),
    ]);
    rethrowZedSessionFailure(
      primary,
      results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      ),
    );
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
    this.unpublishedSessions.delete(session);
    this.sessions.set(sessionId, session);
    try {
      await session.streamHistory(history);
    } catch (error) {
      this.logger.debug(() => `loadSession - replay failed: ${error}`);
      return this.rejectSession(sessionId, session, error);
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
    let history: readonly IContent[];
    let session: Session;
    try {
      history = await resumeAgentHistory(
        agent,
        sessionId,
        this.config.projectChatsDir,
        this.sessionFileLister,
      );
      session = new Session(
        sessionId,
        projectZedSessionAgent(agent),
        this.projectSessionSettings(agent),
        this.connection,
        this.supportsConfigOptions(),
        terminals,
      );
    } catch (primary) {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => agent.dispose()),
        Promise.resolve().then(() => terminals?.dispose()),
      ]);
      this.logger.debug(() => `loadSession - build/resume failed: ${primary}`);
      rethrowZedSessionFailure(
        toLoadRequestError(sessionId, primary),
        results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      );
    }
    this.unpublishedSessions.add(session);
    if (this.closing !== undefined) {
      await this.releaseSession(session);
      this.assertOpen();
    }
    return { session, history };
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
        await terminals?.dispose();
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
    return this.admitWork(() => this.lifecycle.delete(params));
  }
  closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    return this.admitWork(() => this.lifecycle.close(params));
  }
  setSessionMode(
    params: acp.SetSessionModeRequest,
  ): Promise<acp.SetSessionModeResponse> {
    this.assertOpen();
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    return Promise.resolve(session.setMode(params.modeId));
  }
  setSessionConfigOption(params: acp.SetSessionConfigOptionRequest) {
    return this.admitWork(() =>
      this.lifecycle.runSerialized(params.sessionId, () =>
        dispatchZedConfigOption(this.clientCapabilities, this.sessions, params),
      ),
    );
  }
  async cancel({ sessionId }: acp.CancelNotification): Promise<void> {
    this.assertOpen();
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    await session.cancelPendingPrompt();
  }
  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    this.assertOpen();
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    return session.prompt(params);
  }
  private assertOpen(): void {
    if (this.closing !== undefined)
      throw new Error('ACP workspace is disposed');
  }
  private async admitWork<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    let complete!: () => void;
    const completed = new Promise<void>((resolve) => {
      complete = resolve;
    });
    this.acceptedWork.add(completed);
    try {
      return await operation();
    } finally {
      this.acceptedWork.delete(completed);
      complete();
    }
  }
  disposeAll(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    let complete!: () => void;
    let fail!: (reason: unknown) => void;
    this.closing = new Promise<void>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    void this.closeWorkspace().then(complete, fail);
    return this.closing;
  }
  private async closeWorkspace(): Promise<void> {
    const accepted = [...this.acceptedWork];
    const sessions = [
      ...new Set([...this.sessions.values(), ...this.unpublishedSessions]),
    ];
    this.sessions.clear();
    this.unpublishedSessions.clear();
    const results = await Promise.allSettled([
      ...sessions.map((session) => session.dispose()),
      ...accepted,
    ]);
    const lateSessions = [
      ...new Set([...this.sessions.values(), ...this.unpublishedSessions]),
    ];
    this.sessions.clear();
    this.unpublishedSessions.clear();
    const late = await Promise.allSettled(
      lateSessions.map((session) => session.dispose()),
    );
    const trust = await Promise.allSettled([
      Promise.resolve().then(() => this.ownedTrust?.dispose()),
    ]);
    const failures = [...results, ...late, ...trust].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'ACP workspace disposal failed');
  }
}
