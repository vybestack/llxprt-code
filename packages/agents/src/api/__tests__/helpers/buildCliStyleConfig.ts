/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P07
 * @requirement:REQ-INT-001,REQ-INT-002
 *
 * CANONICAL shared helper for the early CLI turn-parity slice. Builds a REAL
 * Config the way the CLI's loadCliConfig path does — a fully-wired Config
 * whose provider runtime is the real FakeProvider (via the
 * LLXPRT_FAKE_RESPONSES production seam), so that:
 *  (a) `fromConfig({ config })` can adopt it and drive a turn (REQ-INT-001),
 *  (b) `config.getAgentClient()` returns a usable AgentClientContract for the
 *      reference AgenticLoop drive (REQ-INT-002).
 *
 * The Config-build path mirrors createAgent's steps (toConfigParameters +
 * agentClientFactory + default toolSchedulerFactory + interactive:true +
 * new Config(params) + isolated runtime context + provider registration +
 * initialize + refreshAuth), but STOPS before building the Agent facade —
 * returning the Config itself for fromConfig to adopt.
 *
 * This is the CANONICAL helper; the broader P19 parity suite REUSES this
 * exact file (P19 MUST NOT duplicate it).
 *
 * Test-helper imports of agents-internal builders (the confirmation-forcing
 * seam, the scheduler factory) follow the established __tests__/helpers/
 * idiom (see agentHarness.ts, bootstrapProbe.ts, confirmationForcingProbe.ts).
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { Config as ConfigType } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  createIsolatedRuntimeContext,
  switchActiveProvider,
  setActiveModel,
  getActiveProviderName,
  getActiveModelName,
} from '@vybestack/llxprt-code-providers/runtime.js';
import type { IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime.js';
import { createProviderManager } from '@vybestack/llxprt-code-providers/composition.js';
import { stripSandboxSegment } from './fixtureRoot.js';
import {
  toConfigParameters,
  AgentClient,
  CoreToolScheduler,
  type AgentEvent,
  type DoneReason,
} from '@vybestack/llxprt-code-agents';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ToolSchedulerFactory } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import {
  wrapRegistryWithConfirmation,
  injectConfirmationForcingPolicy,
} from '../../confirmationForcing.js';
import type { AgentConfig } from '../../config-types.js';

const HARNESS_DIR = stripSandboxSegment(
  fileURLToPath(new URL('.', import.meta.url)),
);
const FIXTURES_DIR = resolve(HARNESS_DIR, '..', 'fixtures');

// ─── Public projection helpers (REQ-INT-002 parity) ─────────────────────────

/**
 * The public-comparable projection of an AgentEvent: only the fields that
 * matter for turn-parity (kind/type, tool name, isError, terminal done reason).
 * Internal fields (prompt_id, traceId) are NEVER included — R-PROJECT (#1594).
 */
export interface ComparableEvent {
  readonly type: string;
  readonly toolName?: string;
  readonly isError?: boolean;
  readonly doneReason?: DoneReason;
}

/**
 * Projects an AgentEvent to its public-comparable form. Uses the event's
 * discriminated `.type` to extract the parity-relevant fields only.
 */
export function projectToComparable(event: AgentEvent): ComparableEvent {
  switch (event.type) {
    case 'tool-call':
      return { type: event.type, toolName: event.call.name };
    case 'tool-result':
      return {
        type: event.type,
        toolName: event.result.name,
        ...(event.result.isError !== undefined
          ? { isError: event.result.isError }
          : {}),
      };
    case 'done':
      return { type: event.type, doneReason: event.reason };
    case 'error':
      return { type: event.type, isError: true };
    default:
      return { type: event.type };
  }
}

/** Projects an array of AgentEvents to their comparable forms. */
export function projectEvents(
  events: readonly AgentEvent[],
): readonly ComparableEvent[] {
  return events.map(projectToComparable);
}

// ─── Config construction (mirrors createAgent's Config-build path) ──────────

export interface BuiltCliConfig {
  readonly config: ConfigType;
  readonly messageBus: MessageBus;
  readonly cleanup: () => Promise<void>;
}

/**
 * The default tool-scheduler factory, mirroring createAgent's
 * createDefaultToolSchedulerFactory. Constructs a CoreToolScheduler backed by
 * the tool registry wrapped so every tool surfaces a REAL confirmation (the
 * confirmation-forcing seam). Without this, Config.getOrCreateScheduler throws
 * "toolSchedulerFactory is required".
 */
function createDefaultToolSchedulerFactory(): ToolSchedulerFactory {
  return (options) => {
    const registry = wrapRegistryWithConfirmation(options.toolRegistry);
    return new CoreToolScheduler({
      config: options.config,
      messageBus: options.messageBus,
      toolRegistry: registry,
      ...(options.outputUpdateHandler !== undefined
        ? { outputUpdateHandler: options.outputUpdateHandler }
        : {}),
      ...(options.onAllToolCallsComplete !== undefined
        ? { onAllToolCallsComplete: options.onAllToolCallsComplete }
        : {}),
      ...(options.onToolCallsUpdate !== undefined
        ? { onToolCallsUpdate: options.onToolCallsUpdate }
        : {}),
      getPreferredEditor: options.getPreferredEditor,
      onEditorClose: options.onEditorClose,
      ...(options.onEditorOpen !== undefined
        ? { onEditorOpen: options.onEditorOpen }
        : {}),
      ...(options.toolContextInteractiveMode !== undefined
        ? {
            toolContextInteractiveMode: options.toolContextInteractiveMode,
          }
        : {}),
    });
  };
}

/**
 * Builds a REAL Config wired to the FakeProvider via the
 * LLXPRT_FAKE_RESPONSES env seam. Mirrors createAgent's Config-build path
 * (toConfigParameters + agentClientFactory + default toolSchedulerFactory +
 * interactive:true + new Config + isolated runtime + provider registration +
 * initialize + refreshAuth), returning the Config for fromConfig to adopt.
 *
 * @param fixtureRelPath  Fixture JSONL path relative to __tests__/fixtures.
 */
export async function buildCliStyleConfig(
  fixtureRelPath: string,
): Promise<BuiltCliConfig> {
  const prev = process.env.LLXPRT_FAKE_RESPONSES;
  const fixturePath = resolve(FIXTURES_DIR, fixtureRelPath);
  process.env.LLXPRT_FAKE_RESPONSES = fixturePath;

  const baseConfig: AgentConfig = {
    provider: 'fake',
    model: 'fake-model',
    workingDir: resolve(HARNESS_DIR, '..'),
  };
  const runtimeId = `cli-config-${randomUUID()}`;

  // toConfigParameters + factory injection (mirrors createAgent steps 20-27).
  const frozenParams = toConfigParameters(baseConfig);
  const params = { ...frozenParams };
  params.agentClientFactory = (config, runtimeState): AgentClientContract =>
    new AgentClient(config, runtimeState);
  params.toolSchedulerFactory = createDefaultToolSchedulerFactory();
  params.interactive = true;

  // Construct Config + ONE shared MessageBus (mirrors createAgent steps 30-38).
  const config = new Config(params);
  config.getWorkspaceContext().addDirectory(process.cwd());
  injectConfirmationForcingPolicy(config.getPolicyEngine());
  const messageBus = new MessageBus(
    config.getPolicyEngine(),
    config.getDebugMode(),
  );
  const settingsService = config.getSettingsService();

  // SHARED runtime context — adopts OUR Config/MessageBus (mirrors createAgent
  // steps 41-58). The prepare callback registers providers (including
  // FakeProvider under LLXPRT_FAKE_RESPONSES) onto the isolated manager.
  const handle: IsolatedRuntimeContextHandle = createIsolatedRuntimeContext({
    runtimeId,
    settingsService,
    config,
    model: baseConfig.model,
    messageBus,
    prepare: (ctx) => {
      registerProvidersOntoManager(ctx.providerManager, ctx, ctx.config);
    },
  });

  try {
    await handle.activate();
    await applyProviderModel(baseConfig, config);
    await config.initialize({ messageBus });
    await config.refreshAuth(undefined);
  } catch (error) {
    await cleanupHandle(handle, prev);
    throw error;
  }

  const cleanup = async (): Promise<void> => {
    await cleanupHandle(handle, prev);
  };

  return { config, messageBus, cleanup };
}

/** Restores the env var and disposes the runtime handle. */
async function cleanupHandle(
  handle: IsolatedRuntimeContextHandle,
  prev: string | undefined,
): Promise<void> {
  await Promise.resolve(handle.cleanup()).catch(() => {
    /* best-effort teardown */
  });
  if (prev === undefined) {
    delete process.env.LLXPRT_FAKE_RESPONSES;
  } else {
    process.env.LLXPRT_FAKE_RESPONSES = prev;
  }
}

/**
 * Applies the initial provider/model through the real runtime mutators
 * (mirrors createAgent's applyInitialProviderModelAuth).
 */
async function applyProviderModel(
  parsed: { readonly provider: string; readonly model: string },
  config: ConfigType,
): Promise<void> {
  const activeProvider = safeActiveProviderName();
  if (parsed.provider !== activeProvider) {
    try {
      await switchActiveProvider(parsed.provider);
    } catch {
      /* Provider not registered (fake mode) — continue with active. */
    }
  }
  const activeModel = safeActiveModelName();
  if (parsed.model !== activeModel) {
    await setActiveModel(parsed.model);
    await config.initializeContentGeneratorConfig();
  }
}

function safeActiveProviderName(): string {
  try {
    return getActiveProviderName();
  } catch {
    return '';
  }
}

function safeActiveModelName(): string {
  try {
    return getActiveModelName();
  } catch {
    return '';
  }
}

/**
 * Registers providers onto the isolated context's ProviderManager (mirrors
 * createAgent's registerProvidersOntoManager). Under LLXPRT_FAKE_RESPONSES
 * this registers only FakeProvider and sets it active.
 */
function registerProvidersOntoManager(
  isolatedManager: IsolatedRuntimeContextHandle['providerManager'],
  source: {
    readonly settingsService: IsolatedRuntimeContextHandle['settingsService'];
    readonly runtimeId: IsolatedRuntimeContextHandle['runtimeId'];
    readonly metadata: IsolatedRuntimeContextHandle['metadata'];
  },
  config: ConfigType,
): void {
  const context = {
    settingsService: source.settingsService,
    runtimeId: source.runtimeId,
    metadata: source.metadata,
  };
  const { manager: registered } = createProviderManager(
    context as Parameters<typeof createProviderManager>[0],
    { config },
  );
  for (const name of registered.listProviders()) {
    const provider = registered.getProviderByName(name);
    if (
      provider !== undefined &&
      !isolatedManager.listProviders().includes(name)
    ) {
      isolatedManager.registerProvider(provider);
    }
  }
  try {
    const active = registered.getActiveProvider();
    void isolatedManager.setActiveProvider(active.name);
  } catch {
    /* No active provider — safe to skip. */
  }
}

// Re-export for spec consumers (avoids deep imports in the spec).
export {
  /** Absolute path to the fixtures directory. */
  FIXTURES_DIR as fixturesDir,
};
export type { AgentEvent, DoneReason } from '@vybestack/llxprt-code-agents';
// Type-only re-exports so consumer-facing specs can annotate Config/MessageBus
// without deep core imports (helpers/ is exempt from the boundary scan).
export type { Config, MessageBus };
