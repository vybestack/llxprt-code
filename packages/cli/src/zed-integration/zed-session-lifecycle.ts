/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as acp from '@agentclientprotocol/sdk';
import {
  deleteSessionById,
  getProjectHash,
  SESSION_NOT_FOUND_PREFIX,
  SessionDiscovery,
  type ApprovalMode,
  type Config,
} from '@vybestack/llxprt-code-core';
import { buildSessionModes } from './zed-helpers.js';
import { listRecordedSessions } from './zed-session-listing.js';
import type { LifecycleSession } from './zed-session-pagination.js';
import type {
  CloseSessionRequest,
  CloseSessionResponse,
  DeleteSessionRequest,
  DeleteSessionResponse,
} from './acp-types.js';

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

  close(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    return this.runSerialized(params.sessionId, async () => {
      await this.disposeLive(params.sessionId);
      return {};
    });
  }

  delete(params: DeleteSessionRequest): Promise<DeleteSessionResponse> {
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
    const projectRoot = this.config.getProjectRoot();
    const summaries = await SessionDiscovery.listSessions(
      this.config.storage.getProjectChatsDir(),
      getProjectHash(projectRoot),
    );
    const target = summaries.find(
      (summary) => summary.sessionId === params.sessionId,
    );
    if (target === undefined || (target.cwd ?? projectRoot) !== params.cwd) {
      throw acp.RequestError.resourceNotFound(params.sessionId);
    }
    const { session } = await this.restore(params.sessionId, params.cwd);
    this.sessions.set(params.sessionId, session);
    try {
      await session.sendAvailableCommands();
      return {
        modes: buildSessionModes(session.getApprovalMode()),
        ...(await this.configOptions(session)),
      };
    } catch (error) {
      this.sessions.delete(params.sessionId);
      await session.dispose().catch(() => undefined);
      throw error;
    }
  }

  private async performDelete(
    params: DeleteSessionRequest,
  ): Promise<DeleteSessionResponse> {
    const hadLiveSession = await this.disposeLive(params.sessionId);
    const projectRoot = this.config.getProjectRoot();
    let result: Awaited<ReturnType<typeof deleteSessionById>>;
    try {
      result = await deleteSessionById(
        params.sessionId,
        this.config.storage.getProjectChatsDir(),
        getProjectHash(projectRoot),
      );
    } catch (error) {
      throw acp.RequestError.internalError({
        sessionId: params.sessionId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    if (result.ok) {
      return {};
    }
    if (result.error.startsWith(SESSION_NOT_FOUND_PREFIX)) {
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
    try {
      await live.dispose();
    } catch {
      // Persisted deletion must still proceed after best-effort live cleanup.
    } finally {
      this.sessions.delete(sessionId);
    }
    return true;
  }
}
