/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as acp from '@agentclientprotocol/sdk';
import {
  deleteSessionById,
  getProjectHash,
  type ApprovalMode,
  type Config,
} from '@vybestack/llxprt-code-core';
import { buildSessionModes } from './zed-helpers.js';
import { listRecordedSessions } from './zed-session-listing.js';
import type { LifecycleSession } from './zed-session-pagination.js';

export interface LifecycleSessionHandle {
  getApprovalMode(): ApprovalMode;
  getLifecycleInfo(): LifecycleSession;
  dispose(): Promise<void>;
  sendAvailableCommands(): Promise<void>;
  getConfigOptions(): Promise<acp.SessionConfigOption[]>;
}

interface RestoredSession {
  readonly session: LifecycleSessionHandle;
}

export class SessionLifecycle {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly config: Config,
    private readonly sessions: Map<string, LifecycleSessionHandle>,
    private readonly restore: (
      sessionId: string,
      cwd: string | undefined,
    ) => Promise<RestoredSession>,
    private readonly configOptions: (
      session: LifecycleSessionHandle,
    ) => Promise<
      Pick<acp.ResumeSessionResponse, 'configOptions'>
    > = async () => ({}),
  ) {}

  list(params: acp.ListSessionsRequest): Promise<acp.ListSessionsResponse> {
    const projectRoot = this.config.getProjectRoot();
    return listRecordedSessions(
      this.config.storage.getProjectChatsDir(),
      getProjectHash(projectRoot),
      projectRoot,
      params,
      [...this.sessions.values()].map((session) => session.getLifecycleInfo()),
    );
  }

  resume(params: acp.ResumeSessionRequest): Promise<acp.ResumeSessionResponse> {
    return this.runSerialized(params.sessionId, () =>
      this.performResume(params),
    );
  }

  close(params: acp.CloseSessionRequest): Promise<acp.CloseSessionResponse> {
    return this.runSerialized(params.sessionId, async () => {
      await this.disposeLive(params.sessionId);
      return {};
    });
  }

  delete(params: acp.DeleteSessionRequest): Promise<acp.DeleteSessionResponse> {
    return this.runSerialized(params.sessionId, () =>
      this.performDelete(params),
    );
  }

  runSerialized<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(sessionId);
    const run = (prior ?? Promise.resolve()).then(operation, operation);
    this.queues.set(sessionId, run);
    return run.finally(() => {
      if (this.queues.get(sessionId) === run) {
        this.queues.delete(sessionId);
      }
    });
  }

  private async performResume(
    params: acp.ResumeSessionRequest,
  ): Promise<acp.ResumeSessionResponse> {
    const live = this.sessions.get(params.sessionId);
    if (live !== undefined) {
      if (live.getLifecycleInfo().cwd !== params.cwd) {
        throw acp.RequestError.resourceNotFound(params.sessionId);
      }
      await live.sendAvailableCommands();
      return {
        modes: buildSessionModes(live.getApprovalMode()),
        ...(await this.configOptions(live)),
      };
    }
    const listed = await this.list({ cwd: params.cwd });
    if (!listed.sessions.some((item) => item.sessionId === params.sessionId)) {
      throw acp.RequestError.resourceNotFound(params.sessionId);
    }
    const { session } = await this.restore(params.sessionId, params.cwd);
    await session.sendAvailableCommands();
    this.sessions.set(params.sessionId, session);
    return {
      modes: buildSessionModes(session.getApprovalMode()),
      ...(await this.configOptions(session)),
    };
  }

  private async performDelete(
    params: acp.DeleteSessionRequest,
  ): Promise<acp.DeleteSessionResponse> {
    const hadLiveSession = await this.disposeLive(params.sessionId);
    const projectRoot = this.config.getProjectRoot();
    const result = await deleteSessionById(
      params.sessionId,
      this.config.storage.getProjectChatsDir(),
      getProjectHash(projectRoot),
    );
    if (result.ok) {
      return {};
    }
    if (result.error.startsWith('Session not found:')) {
      if (hadLiveSession) {
        return {};
      }
      throw acp.RequestError.resourceNotFound(params.sessionId);
    }
    throw acp.RequestError.internalError({
      sessionId: params.sessionId,
      reason: result.error,
    });
  }

  private async disposeLive(sessionId: string): Promise<boolean> {
    const live = this.sessions.get(sessionId);
    if (live === undefined) {
      return false;
    }
    await live.dispose();
    this.sessions.delete(sessionId);
    return true;
  }
}
