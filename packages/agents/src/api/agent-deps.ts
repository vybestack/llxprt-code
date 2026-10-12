/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { WorkspaceSkillOperations } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { TaskLaunchOwner } from '../session/task-launch-owner.js';
import type { ShellJobOwner } from '../session/shell-job-owner.js';
import type { AgentMcpOperations } from './mcpRuntimeAssembly.js';
import type {
  Config,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-providers/runtime/providerSwitch.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { LoopHolder, RebuildLoopDeps } from './loop/rebuildLoop.js';
import type {
  OwnershipRecord,
  StableDisplayCallbacksHolder,
} from './agentBootstrap.js';
import type {
  ApprovalHandler,
  DisplayCallbacks,
} from '../core/agenticLoop/types.js';
import type { EditorCallbacks, AgentAuth } from './config-types.js';

/**
 * The bootstrap dependency bundle injected into AgentImpl by buildAgent.
 * @pseudocode createAgent.md steps 150-160
 */
export interface AgentDeps {
  readonly settingsOwner: SessionSettingsOwner;
  readonly sessionClient: SessionClientOwner;
  readonly workspaceSkills: WorkspaceSkillOperations;
  readonly mediaStore?: LocalMediaStore;
  readonly mediaOwner?: SessionMediaOwner;
  readonly taskLaunchOwner: TaskLaunchOwner;
  readonly shellOwner: ShellJobOwner;
  readonly mcpOperations: AgentMcpOperations;
  readonly config: Config;
  readonly providerManager: RuntimeProviderManager;
  readonly oauthManager: OAuthManager;
  readonly switchProvider: ProviderSwitcher;
  readonly settingsService: SettingsService;
  readonly runtimeId: string;
  readonly runtimeHandle: {
    cleanup: () => Promise<void> | void;
  };
  readonly messageBus: MessageBus;
  readonly loopHolder: LoopHolder;
  readonly runtimeState: AgentRuntimeState;
  readonly ownership: OwnershipRecord;
  readonly sessionIdentityOwnership: 'config' | 'facade';
  readonly rebuildLoop: (deps: RebuildLoopDeps) => unknown;
  readonly resolveClient: () => AgentClientContract;
  /**
   * The HistoryService instance createAgent eagerly created + stored for reuse
   * (storeHistoryServiceForReuse). Used as a fallback in the historyService
   * getter so the REQ-005 identity probe returns a non-null instance BEFORE
   * the chat is initialized (startChat runs lazily on the first turn). Because
   * transferHistoryToNewClient reuses the SAME stored instance across a
   * switch, this fallback keeps the before/after identity probe consistent.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-005
   */
  readonly initialHistoryService?: HistoryService;
  /**
   * The approvalHandler createAgent built (wrapApprovalHandler(onApproval)).
   * Threaded through so every P16 client-rebinding rebuild reuses it.
   * @plan:PLAN-20260617-COREAPI.P16
   */
  readonly approvalHandler?: ApprovalHandler;
  /** Stable forwarding DisplayCallbacks; reads live from the holders. @plan:PLAN-20260617-COREAPI.P16 */
  readonly displayCallbacks: DisplayCallbacks;
  /** Shared editor-callbacks holder, threaded for ToolControl + forwarding object. */
  readonly editorCallbacksHolder: { editorCallbacks: EditorCallbacks };
  /** Shared display-callbacks holder, threaded for ToolControl + forwarding object. */
  readonly displayCallbacksHolder: StableDisplayCallbacksHolder;
  readonly onOAuthPrompt?: unknown;
  readonly editorCallbacks?: EditorCallbacks;
  /**
   * The initial auth config threaded from createAgent (parsed.auth). Used to
   * seed the per-agent auth-state holder at construction.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  readonly initialAuth?: AgentAuth;
}
