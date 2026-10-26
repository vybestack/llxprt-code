/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ApprovalMode,
  type Config,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import type {
  AgentInput,
  AgentMessage,
  CompressionResult,
  GenerateOptions,
  TurnOptions,
} from './agent.js';
import type { AgentExecutionCoordinator } from './agentExecutionCoordinator.js';
import type { ProfilesControl } from './control/profilesControl.js';
import type { SessionControl } from './control/sessionControl.js';
import type { IdeControl } from './control/ideControl.js';
import type { ToolControl } from './control/toolControl.js';
import {
  assembleDirectProviderAdmission,
  type DirectProviderAdmission,
} from './directProviderAdmission.js';
import type { AgentEvent } from './event-types.js';
import { ForegroundRunLifecycle } from './foregroundRunLifecycle.js';
import type { AgentMcpOperations } from './mcpRuntimeAssembly.js';
import { createRecordingExecution } from './recordingExecution.js';
import { resetIdleChat } from './session-control-assembly.js';
import {
  UNCONFIGURED_AGENT_MESSAGE,
  type SessionProviderControl,
} from './session-provider-reads.js';

export interface AgentTurnOwners {
  readonly session: SessionClientOwner;
  readonly coordinator: AgentExecutionCoordinator;
  readonly providerAdmission: DirectProviderAdmission;
  readonly recording: SessionControl;
  readonly profiles: Pick<ProfilesControl, 'isApplying'>;
  readonly providers: Pick<
    SessionProviderControl,
    'isProviderReady' | 'assertProfileIdle' | 'getModel'
  >;
  readonly awaitMcpDiscovery: AgentMcpOperations['awaitDiscovery'];
  readonly tools: Pick<ToolControl, 'notifyConfirmation' | 'notifyToolUpdate'>;
}

export interface AgentApprovalOwner {
  isTrustedFolder(): boolean;
  readApprovalMode(): ApprovalMode;
  writeApprovalMode(mode: ApprovalMode): void;
}

export function createAgentApprovalOwner(
  ide: IdeControl,
  config: Config,
): AgentApprovalOwner {
  return {
    isTrustedFolder: () => ide.isTrustedFolder(),
    readApprovalMode: () => config.getApprovalMode(),
    writeApprovalMode: (mode) => config.setApprovalMode(mode),
  };
}

export function createAgentTurnOwners(
  session: SessionClientOwner,
  providers: SessionProviderControl,
  recording: SessionControl,
  tools: ToolControl,
  settingsService: SettingsService,
  providerManager: RuntimeProviderManager,
  awaitMcpDiscovery: AgentMcpOperations['awaitDiscovery'],
): AgentTurnOwners {
  return {
    session,
    coordinator: providers.coordinator,
    providerAdmission: assembleDirectProviderAdmission(
      settingsService,
      providerManager,
      () => providers.getModel(),
    ),
    recording,
    profiles: providers.profiles,
    providers,
    awaitMcpDiscovery,
    tools,
  };
}

export class AgentOperations {
  readonly #turns: AgentTurnOwners;
  readonly #approval: AgentApprovalOwner;

  constructor(turns: AgentTurnOwners, approval: AgentApprovalOwner) {
    this.#turns = turns;
    this.#approval = approval;
  }

  readonly #readHookSessionId = (): string =>
    this.#turns.recording.getSessionId();

  /**
   * Injects a mid-turn steer message into the active agent loop. Delegates to
   * the current loop's injectSteer. No-op when no loop is running.
   */
  injectSteer(text: string): void {
    this.#turns.coordinator.current()?.loop?.injectSteer(text);
  }

  /** Streams AgentEvents by delegating to the current loop's run(). */
  stream(input: AgentInput, opts?: TurnOptions): AsyncIterable<AgentEvent> {
    const turns = this.#turns;
    return new ForegroundRunLifecycle(
      createRecordingExecution(
        turns.recording,
        this.#readHookSessionId,
        turns.session.hookOperations,
      ),
      () => turns.profiles.isApplying(),
      () => turns.providers.isProviderReady(),
      (run) => turns.coordinator.admit(run),
      (run) => turns.coordinator.release(run),
      () => turns.session.resolveExecution(),
      () => turns.providerAdmission.admit(),
      () => turns.awaitMcpDiscovery(),
      turns.tools.notifyConfirmation.bind(turns.tools),
      turns.tools.notifyToolUpdate.bind(turns.tools),
    ).stream(input, opts);
  }

  getApprovalMode(): ApprovalMode {
    return this.#approval.isTrustedFolder()
      ? this.#approval.readApprovalMode()
      : ApprovalMode.DEFAULT;
  }

  setApprovalMode(mode: ApprovalMode): void {
    if (!this.#approval.isTrustedFolder() && mode !== ApprovalMode.DEFAULT)
      throw new Error(
        'Cannot enable privileged approval modes in an untrusted folder.',
      );
    this.#approval.writeApprovalMode(mode);
  }

  /**
   * Resets the chat through the durable history-clear path while recording is
   * active, preserving its initial history prefix. Without recording, delegates to the
   * client's full reset contract.
   */
  async resetChat(): Promise<void> {
    const turns = this.#turns;
    turns.providers.assertProfileIdle();
    await resetIdleChat(turns.coordinator, turns.recording, () =>
      turns.session.conversation.resetChat(),
    );
  }

  /**
   * Explicitly triggers history compression via the chat contract's
   * performCompression, mapping the fine-grained PerformCompressionResult enum
   * to the public CompressionResult.status and capturing token counts (from the
   * HistoryService) only when the history was actually compressed. The public
   * original/new token counts are guaranteed monotonic (original >= new) on the
   * 'compressed' path.
   */
  async compress(opts?: {
    readonly promptId?: string;
  }): Promise<CompressionResult> {
    const turns = this.#turns;
    if (!turns.providers.isProviderReady())
      throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    // Ensure the chat is initialized before accessing it: setHistory can run
    // before the first turn (startChat is otherwise lazy on first turn).
    return turns.session.compressHistory(
      opts?.promptId ?? `compress-${Date.now()}`,
      turns.recording,
      turns.session.hookOperations,
    );
  }

  /**
   * Side-channel single-shot generation. Delegates to the client's detached
   * direct-message path. History reads and writes are opt-in, and generation
   * does not run a tool loop. Returns the response
   * text (empty string when the model emits no text part).
   */
  async generate(input: AgentInput, opts?: GenerateOptions): Promise<string> {
    const turns = this.#turns;
    if (!turns.providers.isProviderReady())
      throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    return turns.session.generateText(
      input,
      opts,
      createRecordingExecution(
        turns.recording,
        () => turns.recording.getSessionId(),
        turns.session.hookOperations,
      ),
      turns.providerAdmission.admit(),
    );
  }

  /**
   * Side-channel structured (JSON) generation. Delegates to the client's
   * generateJson contract against a snapshot copy of the supplied contents —
   * detached from the live conversation history.
   */
  async generateJson(
    contents: readonly AgentMessage[],
    schema: Readonly<Record<string, unknown>>,
    opts?: GenerateOptions,
  ): Promise<Record<string, unknown>> {
    const turns = this.#turns;
    if (!turns.providers.isProviderReady())
      throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    return turns.session.generateJson(
      contents,
      schema,
      opts?.model ?? turns.providers.getModel(),
      opts?.signal,
    );
  }

  /**
   * Side-channel embedding generation. Delegates to the client's
   * generateEmbedding contract against a snapshot copy of the input texts —
   * detached from the live conversation history.
   */
  async generateEmbedding(texts: readonly string[]): Promise<number[][]> {
    const turns = this.#turns;
    if (!turns.providers.isProviderReady())
      throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    return turns.session.generateEmbedding(texts);
  }
}
