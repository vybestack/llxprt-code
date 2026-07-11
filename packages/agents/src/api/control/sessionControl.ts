/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 *
 * SessionControl implements the public `agent.session` surface (REQ-010),
 * mapping checkpoint create/restore/list, recording swap, and resume onto the
 * real core session machinery WITHOUT any deep CLI imports:
 *
 * - Checkpoint trio is backed by the core Logger (checkpoint-<tag>.json files
 *   under the project storage temp dir). The client's getHistory() already
 *   returns Gemini Content[], so SAVE persists that Content[] directly to the
 *   Logger (no conversion). Only RESTORE bridges back: ContentConverters
 *   converts the loaded Content[] to IContent[] before the client restore path.
 * - Recording is backed by SessionRecordingService; setRecording(true) starts a
 *   service and seeds it with the current history so a file is materialized,
 *   then subscribes a RecordingIntegration to the client's HistoryService so
 *   EVERY subsequent turn's content is appended to the JSONL file (continuous
 *   recording, not a one-shot snapshot). setRecording(false) disposes the
 *   integration + service.
 * - resume is backed by resumeSession (CONTINUE_LATEST for 'latest'); a success
 *   feeds the reconstructed IContent history through the client restore path,
 *   adopts the returned recording service, subscribes a fresh RecordingIntegration
 *   so post-resume turns keep appending to the resumed file, and returns the
 *   restored IContent[] so callers (e.g. the Zed loadSession path) can replay it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { Content } from '@google/genai';
import { join } from 'node:path';
import {
  Logger,
  SessionRecordingService,
  RecordingIntegration,
  resumeSession,
  CONTINUE_LATEST,
  getProjectHash,
  type ResumeRequest,
  type LockHandle,
} from '@vybestack/llxprt-code-core';
import { ContentConverters } from '@vybestack/llxprt-code-core/services/history/ContentConverters.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type {
  AgentSessionControl,
  SessionCheckpoint,
  SessionRecordingState,
} from '../agent.js';

const CHECKPOINT_PREFIX = 'checkpoint-';
const CHECKPOINT_SUFFIX = '.json';
const RECORDING_FORMAT = 'jsonl';

/**
 * Module logger mirroring the neighboring toolControl.ts precedent
 * (a module-scoped core DebugLogger). Used to surface an otherwise-silent
 * recording-subscription gap so lost continuous recording is diagnosable.
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 */
const logger = new DebugLogger('llxprt:agents:session-control');

/**
 * The shape of a parsed checkpoint file payload (Logger.saveCheckpoint writes
 * `{ history, context? }`). Loosely validated when reading the listing.
 */
interface CheckpointFilePayload {
  readonly history?: unknown;
}

/**
 * Callback bundle injected by AgentImpl so SessionControl can drive the core
 * session machinery without holding a back-reference to the whole AgentImpl.
 * Mirrors the ProfilesControlDeps pattern (lazy accessors / callbacks).
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 */
export interface SessionControlDeps {
  /** The live Config (storage, project root, workspace context). */
  readonly config: Config;
  /** The per-agent session id (AgentImpl uses deps.runtimeId). */
  readonly sessionId: () => string;
  /** Resolves the live AgentClient (the same contract restoreHistory uses). */
  readonly resolveClient: () => AgentClientContract;
  /** The per-agent active provider name. */
  readonly getProvider: () => string;
  /** The per-agent active model name. */
  readonly getModel: () => string;
}

export class SessionControl implements AgentSessionControl {
  /**
   * The initialized core Logger, created lazily on first checkpoint use and
   * reused thereafter. The Logger persists checkpoint-<tag>.json files under
   * the project storage temp dir.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private logger: Logger | undefined;

  /**
   * The live recording service when recording is enabled, or null when it is
   * disabled. getRecording reflects this directly.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private recording: SessionRecordingService | null = null;

  /**
   * The live RecordingIntegration bridging the client's HistoryService
   * 'contentAdded'/compression events onto the active recording service, or
   * null when recording is disabled. This is what makes recording CONTINUOUS
   * (every subsequent turn is appended) rather than a one-shot snapshot. It is
   * created + subscribed by startRecording/resume and disposed (unsubscribed)
   * by releaseRecording so no history-event listener leaks past a stop/resume/
   * dispose.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private integration: RecordingIntegration | null = null;

  /**
   * The on-disk session lock acquired by a successful resume, or null when no
   * resume holds a lock. Released (and cleared) when a new resume replaces it,
   * when recording is stopped, or when the surface is disposed.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private currentLockHandle: LockHandle | null = null;

  constructor(private readonly deps: SessionControlDeps) {}

  /**
   * Resumes a previously recorded session via the core resumeSession flow.
   * `target:'latest'` resolves to CONTINUE_LATEST; any other target is a
   * session reference (id or, when options.prefix is set, an id-prefix that the
   * core SessionDiscovery resolves). On success the returned recording service
   * is adopted as the live recording (installed on Config as the active
   * recording, same swap semantics as setRecording) and the returned session
   * lock is retained, both stored into the instance fields SYNCHRONOUSLY before
   * any await. The prior recording service and session lock are then released,
   * and the reconstructed IContent history is fed through the client restore
   * path. Adopting the resumed recording + lock before any throwable await
   * guarantees that if prior teardown or restoreHistory fails, the resumed
   * recording service and on-disk session lock remain owned by the fields and
   * are released by dispose()/teardownActiveSession(), so neither the prior nor
   * the resumed resources leak on any path. On failure a clear typed Error is
   * thrown carrying the core error (never a not-implemented signal).
   *
   * After the resumed history is restored into the client, a fresh
   * RecordingIntegration is subscribed to the client's HistoryService so
   * post-resume turns keep appending to the resumed JSONL file (continuous
   * recording across the resume boundary). The prior integration (if any) is
   * disposed alongside the prior recording so no history-event listener leaks.
   *
   * Returns the reconstructed IContent[] history so callers that need to replay
   * the restored conversation (e.g. the Zed ACP loadSession path streaming
   * session/update notifications) can consume it directly WITHOUT a lossy
   * getHistory() Gemini Content[] round-trip. Callers that ignore the return
   * value remain source-compatible.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async resume(
    target: 'latest' | string,
    _options?: { readonly prefix?: boolean },
  ): Promise<readonly IContent[]> {
    const request: ResumeRequest = {
      continueRef: target === 'latest' ? CONTINUE_LATEST : target,
      projectHash: getProjectHash(this.deps.config.getProjectRoot()),
      chatsDir: this.chatsDir(),
      currentProvider: this.deps.getProvider(),
      currentModel: this.deps.getModel(),
      workspaceDirs: this.workspaceDirs(),
    };
    const result = await resumeSession(request);
    if (!result.ok) {
      throw new Error(`Failed to resume session: ${result.error}`);
    }
    // Capture the prior recording service + integration + session lock, then
    // adopt the resumed recording + lock into the instance fields (and install
    // the recording on Config) SYNCHRONOUSLY — before any await. Adopting before
    // any throwable await guarantees the resumed recording service and on-disk
    // session lock are owned by the fields on every subsequent throw path
    // (prior-resource teardown OR restoreHistory), so dispose()/
    // teardownActiveSession() can always release them and neither the prior nor
    // the resumed resources can leak.
    const priorRecording = this.recording;
    const priorIntegration = this.integration;
    const priorLockHandle = this.currentLockHandle;
    this.recording = result.recording;
    this.integration = null;
    this.deps.config.setSessionRecordingService(result.recording);
    this.currentLockHandle = result.lockHandle;
    // Release the prior integration + recording service + session lock now that
    // the resumed resources are owned. The captured prior locals are disposed/
    // released directly (NOT via releaseRecording/releaseLockHandle, which act on
    // the fields that now hold the resumed resources). Each step is guarded so a
    // single prior-teardown failure does not skip the others; a collected failure
    // is surfaced after the resumed history is restored.
    const teardownErrors: unknown[] = [];
    if (priorIntegration !== null) {
      this.guardSync(teardownErrors, () => priorIntegration.dispose());
    }
    await this.guard(teardownErrors, async () => {
      if (priorRecording !== null) {
        await priorRecording.dispose();
      }
    });
    await this.guard(teardownErrors, async () => {
      if (priorLockHandle !== null) {
        await priorLockHandle.release();
      }
    });
    await this.deps.resolveClient().restoreHistory(result.history);
    // Subscribe a fresh integration AFTER restoreHistory so the client's chat
    // (and thus its HistoryService) is materialized; post-resume turns now
    // append to the resumed file. Guarded so a subscription failure does not
    // mask a prior-teardown failure surfaced below.
    this.guardSync(teardownErrors, () =>
      this.subscribeIntegration(result.recording),
    );
    if (teardownErrors.length > 0) {
      throw teardownErrors[0];
    }
    return result.history;
  }

  /**
   * Creates a checkpoint of the live conversation history. The live history is
   * obtained via the client's getHistory() (which returns Gemini Content[]) and
   * persisted directly via the core Logger under the tag (defaulting to a
   * timestamped tag when no label is supplied); no conversion is needed on save.
   * The returned SessionCheckpoint reflects the tag, the save timestamp, and the
   * saved message count.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async createCheckpoint(label?: string): Promise<SessionCheckpoint> {
    const logger = await this.getLogger();
    const tag = label ?? `checkpoint-${Date.now()}`;
    const history = (await this.deps.resolveClient().getHistory()) as Content[];
    await logger.saveCheckpoint(
      history as Parameters<typeof logger.saveCheckpoint>[0],
      tag,
    );
    return {
      id: tag,
      createdAt: new Date().toISOString(),
      label: tag,
      messageCount: history.length,
    };
  }

  /**
   * Restores a previously created checkpoint by id (tag). The persisted Gemini
   * Content[] history is converted to IContent[] and fed through the SAME
   * client restore path the public restoreHistory uses, so the next turn (and
   * getHistory) observe the restored conversation.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async restoreCheckpoint(id: string): Promise<void> {
    const logger = await this.getLogger();
    const { history } = await logger.loadCheckpoint(id);
    const items: IContent[] = ContentConverters.toIContents(history);
    await this.deps.resolveClient().restoreHistory(items);
  }

  /**
   * Lists the checkpoints persisted under the project storage temp dir. Each
   * checkpoint-<encodedTag>.json file maps to a SessionCheckpoint: id/label is
   * the decoded tag, createdAt is the file mtime ISO string, and messageCount
   * is the length of the saved history array.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  listCheckpoints(): readonly SessionCheckpoint[] {
    const dir = this.deps.config.storage.getProjectTempDir();
    const entries = this.safeReadDir(dir);
    const checkpoints: SessionCheckpoint[] = [];
    for (const entry of entries) {
      if (
        !entry.startsWith(CHECKPOINT_PREFIX) ||
        !entry.endsWith(CHECKPOINT_SUFFIX)
      ) {
        continue;
      }
      const encodedTag = entry.slice(
        CHECKPOINT_PREFIX.length,
        entry.length - CHECKPOINT_SUFFIX.length,
      );
      const tag = this.decodeTag(encodedTag);
      const abs = join(dir, entry);
      checkpoints.push({
        id: tag,
        createdAt: this.fileMtimeIso(abs),
        label: tag,
        messageCount: this.readCheckpointMessageCount(abs),
      });
    }
    return checkpoints;
  }

  /**
   * Enables or disables session recording. Enabling starts a fresh
   * SessionRecordingService for this session and seeds it with the current
   * history so the JSONL file is materialized (and getRecording().path is
   * defined). Disabling flushes + disposes the live service and clears it.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async setRecording(state: SessionRecordingState): Promise<void> {
    if (state.enabled) {
      await this.startRecording();
      return;
    }
    await this.stopRecording();
  }

  /**
   * Returns the current recording state. enabled reflects the live service's
   * isActive(); path reflects its materialized file (only included when
   * defined); format is the fixed JSONL recording format.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  getRecording(): SessionRecordingState {
    const service = this.recording;
    const enabled = service?.isActive() ?? false;
    const path = service?.getFilePath() ?? null;
    return {
      enabled,
      format: RECORDING_FORMAT,
      ...(path !== null ? { path } : {}),
    };
  }

  // ─── Recording helpers ───────────────────────────────────────────────────

  /**
   * Starts a fresh recording service for this session, replacing any prior one
   * (the prior service + integration are flushed + disposed first). The current
   * history is recorded as content events so the file materializes and
   * getRecording().path is defined. The freshly built service is installed on
   * Config via setSessionRecordingService so the rest of the system (which reads
   * the active recording via config.getSessionRecordingService) observes the
   * swap. A RecordingIntegration is then subscribed to the client's
   * HistoryService so EVERY subsequent turn's 'contentAdded' event is appended
   * to the JSONL file — this is what makes recording continuous rather than a
   * one-shot snapshot.
   *
   * HistoryService availability: the agents-package client eagerly creates +
   * stores a HistoryService at construction (storeHistoryServiceForReuse) and
   * reuses that SAME instance across turns (createChatSessionSafe reuses the
   * stored service), so getHistoryService() is non-null here and the single
   * subscription established now captures all future turns. If it is
   * nonetheless null at this moment (no client/chat), the integration is still
   * created and Config still owns the service; subscribeIntegration is a no-op
   * that the next startRecording/resume re-attempts.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async startRecording(): Promise<void> {
    await this.stopRecording();
    const service = new SessionRecordingService({
      sessionId: this.deps.sessionId(),
      projectHash: getProjectHash(this.deps.config.getProjectRoot()),
      chatsDir: this.chatsDir(),
      workspaceDirs: this.workspaceDirs(),
      provider: this.deps.getProvider(),
      model: this.deps.getModel(),
    });
    const history = (await this.deps.resolveClient().getHistory()) as Content[];
    const items: IContent[] = ContentConverters.toIContents(history);
    for (const item of items) {
      service.recordContent(item);
    }
    await service.flush();
    this.recording = service;
    this.deps.config.setSessionRecordingService(service);
    this.subscribeIntegration(service);
  }

  /**
   * Creates a RecordingIntegration around the given service and subscribes it
   * to the client's HistoryService so future 'contentAdded'/compression events
   * are appended continuously. Stored in the instance field so releaseRecording
   * can dispose it (unsubscribe) on stop/resume/dispose. When the client's
   * HistoryService is not yet available, the integration is still created +
   * stored but left unsubscribed; a later start/resume re-attempts the
   * subscription. Idempotent per call: any prior integration is disposed first
   * so no duplicate listeners accumulate.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private subscribeIntegration(service: SessionRecordingService): void {
    if (this.integration !== null) {
      this.integration.dispose();
      this.integration = null;
    }
    const integration = new RecordingIntegration(service);
    const historyService = this.deps.resolveClient().getHistoryService();
    if (historyService !== null) {
      integration.subscribeToHistory(historyService);
    } else {
      // No HistoryService yet: the integration is created + stored but left
      // unsubscribed, so NO subsequent turn is appended until a later
      // start/resume re-attempts the subscription. Left silent this is an
      // invisible continuous-recording loss; warn so it is diagnosable.
      logger.warn(
        () =>
          `subscribeIntegration: HistoryService unavailable for session ${this.deps.sessionId()}; ` +
          `recording integration left unsubscribed (subsequent turns will not be recorded until re-subscribed)`,
      );
    }
    this.integration = integration;
  }

  /**
   * Flushes + disposes the live recording service (if any), clears it from
   * Config (so the system no longer sees an active recording), and releases any
   * session lock held by a prior resume. Each teardown step is guarded so a
   * single failure does not skip the others.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async stopRecording(): Promise<void> {
    await this.teardownActiveSession();
  }

  /**
   * Disposes the live RecordingIntegration (unsubscribing its HistoryService
   * listeners) and the live recording service (if any), clears the private
   * fields, and clears the service from Config. The integration is disposed
   * FIRST so no 'contentAdded' event can reach a service mid-disposal. No-op
   * when no recording is active.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async releaseRecording(): Promise<void> {
    const integration = this.integration;
    if (integration !== null) {
      this.integration = null;
      integration.dispose();
    }
    const service = this.recording;
    if (service === null) {
      return;
    }
    this.recording = null;
    this.deps.config.setSessionRecordingService(undefined);
    await service.dispose();
  }

  /**
   * Releases the on-disk session lock held by a prior resume (if any) and clears
   * the field. No-op when no lock is held.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async releaseLockHandle(): Promise<void> {
    const handle = this.currentLockHandle;
    if (handle === null) {
      return;
    }
    this.currentLockHandle = null;
    await handle.release();
  }

  /**
   * Awaits fn and collects any throw/rejection into the errors accumulator so a
   * single failed teardown step does not skip the remaining steps.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async guard(
    errors: unknown[],
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (e) {
      errors.push(e);
    }
  }

  /**
   * Synchronous variant of {@link guard} for non-awaitable teardown/subscription
   * steps (integration dispose/subscribe) so a single failure is collected
   * rather than short-circuiting the remaining steps.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private guardSync(errors: unknown[], fn: () => void): void {
    try {
      fn();
    } catch (e) {
      errors.push(e);
    }
  }

  // ─── Surface teardown ──────────────────────────────────────────────────────

  /**
   * Disposes the active recording service (if any) and releases the held
   * session lock (if any) on agent teardown. Each step is guarded so a single
   * failure does not skip the others; the first collected failure is rethrown
   * after all steps run.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async dispose(): Promise<void> {
    await this.teardownActiveSession();
  }

  /**
   * Releases the active recording service and the held session lock, guarding
   * each step so a single failure does not skip the others and rethrowing the
   * first collected failure after all steps run. Shared by stopRecording (the
   * setRecording(false) / pre-resume path) and dispose (agent teardown).
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async teardownActiveSession(): Promise<void> {
    const errors: unknown[] = [];
    await this.guard(errors, () => this.releaseRecording());
    await this.guard(errors, () => this.releaseLockHandle());
    if (errors.length > 0) {
      throw errors[0];
    }
  }

  // ─── Checkpoint helpers ──────────────────────────────────────────────────

  /**
   * Returns the initialized core Logger, constructing + initializing it once
   * and reusing it thereafter.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async getLogger(): Promise<Logger> {
    if (this.logger === undefined) {
      const logger = new Logger(
        this.deps.sessionId(),
        this.deps.config.storage,
      );
      await logger.initialize();
      this.logger = logger;
    }
    return this.logger;
  }

  /**
   * Reads the saved history length from a checkpoint file, returning 0 when the
   * file is unreadable or its history is not an array.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private readCheckpointMessageCount(absPath: string): number {
    const payload = this.readCheckpointPayload(absPath);
    if (payload === undefined || !Array.isArray(payload.history)) {
      return 0;
    }
    return payload.history.length;
  }

  /**
   * Reads + parses a checkpoint file payload, returning undefined when the file
   * is missing or not valid JSON.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private readCheckpointPayload(
    absPath: string,
  ): CheckpointFilePayload | undefined {
    let raw: string;
    try {
      raw = readFileSync(absPath, 'utf8');
    } catch {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        return undefined;
      }
      return parsed as CheckpointFilePayload;
    } catch {
      return undefined;
    }
  }

  /**
   * Returns a file's mtime as an ISO string, falling back to the current time
   * when the file cannot be stat'd.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private fileMtimeIso(absPath: string): string {
    try {
      return statSync(absPath).mtime.toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  /**
   * Decodes a percent-encoded checkpoint tag (the Logger encodes tags via
   * encodeURIComponent). Falls back to the raw value on malformed encoding.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private decodeTag(encoded: string): string {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  /**
   * Reads a directory's entry names, returning an empty array when the
   * directory does not exist or is unreadable (the deterministic empty path
   * before any checkpoint is saved).
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private safeReadDir(dir: string): readonly string[] {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  }

  // ─── Path derivation ─────────────────────────────────────────────────────

  /**
   * Derives the chats directory (where session recordings live) from the
   * project storage temp dir, matching the CLI's derivation.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private chatsDir(): string {
    return join(this.deps.config.storage.getProjectTempDir(), 'chats');
  }

  /**
   * Returns the workspace directories from the live workspace context.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private workspaceDirs(): string[] {
    return [...this.deps.config.getWorkspaceContext().getDirectories()];
  }
}
