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
import { rethrowZedSessionFailure } from './zed-session-errors.js';
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
  private readonly knownClosedSessions = new Set<string>();

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
      this.config.projectChatsDir,
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
      if (this.sessions.has(params.sessionId))
        this.knownClosedSessions.add(params.sessionId);
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
    // A failed operation must not poison the session queue; the next operation
    // starts after either settlement while each caller still receives its own
    // operation's rejection.
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
      this.config.projectChatsDir,
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
      const results = await Promise.allSettled([
        Promise.resolve().then(() => session.dispose()),
      ]);
      rethrowZedSessionFailure(
        error,
        results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      );
    }
  }

  private async performDelete(
    params: DeleteSessionRequest,
  ): Promise<DeleteSessionResponse> {
    if (this.sessions.has(params.sessionId))
      this.knownClosedSessions.add(params.sessionId);
    const [release] = await Promise.allSettled([
      this.disposeLive(params.sessionId),
    ]);
    let response: DeleteSessionResponse;
    try {
      response = await this.deleteRecording(params);
    } catch (primary) {
      rethrowZedSessionFailure(
        primary,
        release.status === 'rejected' ? [release.reason] : [],
      );
    }
    if (release.status === 'rejected') throw release.reason;
    return response;
  }

  private async deleteRecording(
    params: DeleteSessionRequest,
  ): Promise<DeleteSessionResponse> {
    const projectRoot = this.config.getProjectRoot();
    let result: Awaited<ReturnType<typeof deleteSessionById>>;
    try {
      result = await deleteSessionById(
        params.sessionId,
        this.config.projectChatsDir,
        getProjectHash(projectRoot),
      );
    } catch (error) {
      throw acp.RequestError.internalError({
        sessionId: params.sessionId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    if (result.ok) {
      this.knownClosedSessions.delete(params.sessionId);
      return {};
    }
    if (result.error.startsWith(SESSION_NOT_FOUND_PREFIX)) {
      if (this.knownClosedSessions.delete(params.sessionId)) {
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
    } finally {
      this.sessions.delete(sessionId);
    }
    return true;
  }
}
