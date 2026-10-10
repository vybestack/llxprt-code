import { resolvePerfSettings } from '../config/configConstructor.js';
import {
  RootTelemetry,
  logCliConfiguration,
  StartSessionEvent,
} from '@vybestack/llxprt-code-telemetry';
import type { TelemetrySettings } from '../config/config.js';
import type { Config } from '../config/config.js';
import type { MCPServerConfig } from '../config/config.js';
import type {
  TaskExecutionPolicy,
  SubagentRunPolicy,
} from './session-settings-policies.js';
import { assembleTaskSchemaPolicy } from '../config/task-schema-policy-assembly.js';
import type { RegistryPolicy } from '@vybestack/llxprt-code-tools';
import { UNCONFIGURED_PROVIDER } from '../config/models.js';
import { captureUserSettings } from './capture-user-settings.js';
import type { LoopDetectionPolicy } from '../services/loopDetectionService.js';
import type { ToolExecutionPolicy } from '@vybestack/llxprt-code-tools';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ReadonlySettingsSnapshot } from '../runtime/AgentRuntimeContext.js';
import { z } from 'zod';
import { captureProviderInvocation } from '../runtime/providerRequestContext.js';
import type { RuntimeInvocationContext } from '../runtime/RuntimeInvocationContext.js';
import type { AdmittedModelParameters } from '../runtime/admittedModelParameters.js';

import { coreEvents } from '../utils/events.js';
import { assertSessionScopedKey } from '@vybestack/llxprt-code-settings';
import { EphemeralDefaultOwnership } from '../config/ephemeralDefaultOwnership.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  buildToolGovernance,
  type ToolGovernance,
} from '@vybestack/llxprt-code-tools';
import {
  normalizeContextLimit,
  normalizeStreamingValue,
} from '../config/ephemeralSettingsHelpers.js';

const runtimePolicySchema = z.object({
  compressionThreshold: z.number().finite().optional().catch(undefined),
  contextLimit: z.number().positive().optional(),
  preserveThreshold: z.number().finite().optional().catch(undefined),
  topPreserveThreshold: z.number().finite().optional().catch(undefined),
  toolFormatOverride: z.string().optional(),
  compressionStrategy: z.string().optional(),
  compressionProfile: z.string().optional(),
  compressionVerification: z.boolean().optional().catch(undefined),
  'media.semantic-purge': z.enum(['off', 'remove', 'summary']).optional(),
  'compression.density.readWritePruning': z.boolean().optional(),
  'compression.density.fileDedupe': z.boolean().optional(),
  'compression.density.recencyPruning': z.boolean().optional(),
  'compression.density.recencyRetention': z.number().optional(),
  'compression.density.compressHeadroom': z.number().optional(),
  'compression.density.optimizeThreshold': z.number().optional(),
  'reasoning.enabled': z.boolean().optional(),
  'reasoning.includeInContext': z.boolean().optional(),
  'reasoning.includeInResponse': z.boolean().optional(),
  'reasoning.format': z.enum(['native', 'field']).optional(),
  'reasoning.stripFromContext': z
    .enum(['all', 'allButLast', 'none'])
    .optional(),
  'reasoning.fieldName': z.string().optional(),
  'reasoning.effort': z
    .enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    .optional(),
  'reasoning.maxTokens': z.number().optional(),
  'reasoning.adaptiveThinking': z.boolean().optional(),
});

export interface WorkspaceMcpSettings {
  readonly mcpServers: Record<string, MCPServerConfig>;
  readonly blockedMcpServers: Array<{ name: string; extensionName: string }>;
  readonly settingsMcpServers: Record<string, MCPServerConfig>;
}

export interface SessionMcpSettingsReads {
  read(): WorkspaceMcpSettings;
  reload(): Promise<WorkspaceMcpSettings>;
}

export function captureMcpSettings(
  settings: WorkspaceMcpSettings,
): WorkspaceMcpSettings {
  return structuredClone(settings);
}

export class SessionSettingsOwner {
  private telemetryRoot: RootTelemetry | undefined;
  private ownsTelemetry = true;
  private telemetrySettings: TelemetrySettings | undefined;
  private telemetryStarted: Promise<void> | undefined;
  private readonly settingsSubscriptions = new Set<() => void>();
  private readonly telemetryListeners = new Set<() => void>();

  bindTelemetry(config: Config, borrowedRoot?: RootTelemetry): RootTelemetry {
    this.assertOpen();
    if (this.telemetryRoot !== undefined) return this.telemetryRoot;
    this.telemetrySettings = config.getTelemetrySettings();
    this.ownsTelemetry = borrowedRoot === undefined;
    this.telemetryRoot =
      borrowedRoot ??
      RootTelemetry.prepare({
        sessionId: config.getSessionId(),
        enabled: config.getTelemetryEnabled(),
        outfile: config.getTelemetryOutfile(),
        maxBytes: config.getTelemetryOutfileMaxBytes(),
        maxFiles: config.getTelemetryOutfileMaxFiles(),
        readPrivacySettings: () => {
          const settings = this.readTelemetrySettings();
          return {
            logPrompts: settings.logPrompts === true,
            logConversations: this.readConversationLoggingEnabled(),
            logApiBodies: settings.logApiBodies === true,
            maxChars: settings.logApiBodyMaxChars ?? 4000,
          };
        },
      });
    return this.telemetryRoot;
  }

  get telemetry(): RootTelemetry {
    if (this.telemetryRoot === undefined)
      throw new Error('Session telemetry has not been assembled');
    return this.telemetryRoot;
  }

  startTelemetry(config: Config): Promise<void> {
    if (!this.ownsTelemetry) return Promise.resolve();
    this.assertOpen();
    this.telemetryStarted ??= this.telemetry
      .setEnabled(this.readTelemetrySettings().enabled === true)
      .then(() => {
        logCliConfiguration(
          config,
          new StartSessionEvent(config),
          this.telemetry,
        );
      });
    return this.telemetryStarted;
  }

  readTelemetrySettings(): TelemetrySettings {
    this.assertOpen();
    if (this.telemetrySettings === undefined)
      throw new Error('Session telemetry settings have not been assembled');
    return structuredClone(this.telemetrySettings);
  }

  readConversationLoggingEnabled(): boolean {
    const configured = process.env.LLXPRT_LOG_CONVERSATIONS;
    return configured === undefined
      ? this.readTelemetrySettings().logConversations === true
      : configured.toLowerCase() === 'true';
  }

  getTelemetryPerfEnabled(): boolean {
    return resolvePerfSettings(this.readTelemetrySettings()).enabled;
  }

  getTelemetryPerfMemory(): boolean {
    return resolvePerfSettings(this.readTelemetrySettings()).memory;
  }

  async updateTelemetrySettings(
    update: Partial<TelemetrySettings>,
  ): Promise<void> {
    this.assertOpen();
    if (!this.ownsTelemetry)
      throw new Error('A child cannot reconfigure its borrowed telemetry root');
    this.telemetrySettings = {
      ...this.readTelemetrySettings(),
      ...structuredClone(update),
    };
    const enabled = this.telemetry.setEnabled(
      this.telemetrySettings.enabled === true,
    );
    const outcomes = await Promise.allSettled([
      enabled,
      ...[...this.telemetryListeners].map((listener) =>
        Promise.resolve().then(listener),
      ),
    ]);
    const failures = outcomes.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        'Telemetry settings publication failed',
      );
  }

  onTelemetrySettingsChange(listener: () => void): () => void {
    this.assertOpen();
    this.telemetryListeners.add(listener);
    return () => {
      this.telemetryListeners.delete(listener);
    };
  }

  subscribeProviderSettings(changed: (key: string) => void): () => void {
    this.assertOpen();
    const listener = (event: { readonly key: string }): void =>
      changed(event.key);
    const cleared = (): void => changed('auth-key');
    this.settings.on('change', listener);
    this.settings.on('provider-change', listener);
    this.settings.on('cleared', cleared);
    const release = (): void => {
      this.settings.off('change', listener);
      this.settings.off('provider-change', listener);
      this.settings.off('cleared', cleared);
      this.settingsSubscriptions.delete(release);
    };
    this.settingsSubscriptions.add(release);
    return release;
  }

  private mcpSettings: SessionMcpSettingsReads | undefined;

  bindMcpSettings(
    initial: WorkspaceMcpSettings,
    load: () => Promise<WorkspaceMcpSettings>,
  ): void {
    this.assertOpen();
    const selected = captureMcpSettings(initial);
    this.mcpSettings = {
      read: () => {
        this.assertOpen();
        return captureMcpSettings(selected);
      },
      reload: async () => {
        this.assertOpen();
        return captureMcpSettings(await load());
      },
    };
  }

  readMcpSettingsBinding(): SessionMcpSettingsReads | undefined {
    this.assertOpen();
    return this.mcpSettings;
  }

  private closed = false;
  private readonly defaults = new EphemeralDefaultOwnership();
  private readonly selectedModels = new Map<
    string,
    { readonly model: string; readonly observed: unknown }
  >();
  private readonly selectionChanged: (event: {
    readonly provider: string;
    readonly key: string;
    readonly newValue: unknown;
    readonly selectionOwner?: object;
  }) => void;

  constructor(private readonly settings: SettingsService) {
    const selectionChanged = (event: {
      readonly provider: string;
      readonly key: string;
      readonly newValue: unknown;
      readonly selectionOwner?: object;
    }): void => {
      if (event.key !== 'model') return;
      const selected = this.selectedModels.get(event.provider);
      if (event.selectionOwner === undefined) {
        if (typeof event.newValue === 'string')
          this.selectedModels.set(event.provider, {
            model: event.newValue,
            observed: event.newValue,
          });
        else this.selectedModels.delete(event.provider);
      } else if (selected !== undefined)
        this.selectedModels.set(event.provider, {
          ...selected,
          observed: event.newValue,
        });
    };
    this.selectionChanged = selectionChanged;
    settings.on('provider-change', selectionChanged);
  }

  assertSettingsIdentity(settings: SettingsService): void {
    this.assertOpen();
    if (settings !== this.settings)
      throw new Error('Session settings adoption requires the original store');
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Session settings owner is closed');
  }

  readRuntimePolicy(): ReadonlySettingsSnapshot {
    this.assertOpen();
    const values = Object.fromEntries(
      Object.keys(runtimePolicySchema.shape).map((key) => [
        key,
        this.settings.get(key),
      ]),
    );
    const semanticPurge = this.readNamedParameter('media.semantic-purge');
    if (
      semanticPurge !== undefined &&
      semanticPurge !== 'off' &&
      semanticPurge !== 'remove' &&
      semanticPurge !== 'summary'
    )
      throw new Error(
        "Invalid media.semantic-purge setting: expected 'off', 'remove', or 'summary'",
      );
    return Object.freeze({
      tools: this.readClientToolPolicy(),
      ...runtimePolicySchema.parse({
        ...values,
        compressionThreshold: this.readNamedParameter('compression-threshold'),
        contextLimit: this.readNamedParameter('context-limit'),
        preserveThreshold: this.readNamedParameter(
          'compression-preserve-threshold',
        ),
        topPreserveThreshold: this.readNamedParameter(
          'compression-top-preserve-threshold',
        ),
        toolFormatOverride: this.readNamedParameter('toolFormat'),
        compressionStrategy: this.readNamedParameter('compression.strategy'),
        compressionProfile: this.readNamedParameter('compression.profile'),
      }),
      toolExecutionPolicy: this.readToolExecutionPolicy(),
      maxOutputTokens: this.settings.get('maxOutputTokens'),
      promptCaching: this.settings.get('prompt-caching'),
      streamTimeoutPolicy: Object.freeze({
        'stream-idle-timeout-ms': this.settings.get('stream-idle-timeout-ms'),
        'stream-first-response-timeout-ms': this.settings.get(
          'stream-first-response-timeout-ms',
        ),
      }),
      showCitations: this.settings.get('ui.showCitations') === true,
      loopDetection: this.readLoopDetectionPolicy(),
      tokenUsageLoggingEnabled: this.settings.get('token-usage-log') !== false,
      promptPolicy: Object.freeze({
        enableToolPrompts: this.settings.get('enable-tool-prompts') === true,
        allMemoriesAreCore:
          this.settings.get('model.allMemoriesAreCore') === true,
        asyncSubagentsEnabled:
          this.settings.get('subagents.asyncEnabled') !== false,
        profileAsyncEnabled:
          this.settings.get('subagents.async.enabled') !== false,
      }),
    });
  }

  prepareProviderInvocation(
    runtimeId: string,
    providerName: string,
    modelParameters?: AdmittedModelParameters,
    signal?: AbortSignal,
  ): RuntimeInvocationContext {
    this.assertOpen();
    return captureProviderInvocation(
      { settingsService: this.settings, runtimeId },
      providerName,
      modelParameters,
      signal,
    );
  }

  readNamedParameter(key: string): unknown {
    this.assertOpen();
    const value = this.settings.get(key);
    let normalized = value;
    if (key === 'streaming') normalized = normalizeStreamingValue(value);
    if (key === 'context-limit') normalized = normalizeContextLimit(value);
    if (normalized !== undefined && normalized !== value)
      this.settings.set(key, normalized);
    return normalized;
  }

  writeNamedParameter(key: string, value: unknown): void {
    this.assertOpen();
    let normalized = value;
    if (key === 'streaming') normalized = normalizeStreamingValue(value);
    if (key === 'context-limit' && value !== undefined)
      normalized = normalizeContextLimit(value);
    if (
      key === 'streaming' &&
      normalized !== undefined &&
      typeof normalized !== 'string'
    )
      throw new Error(
        'Streaming setting must resolve to "enabled" or "disabled"',
      );
    this.settings.set(key, normalized);
  }

  captureNamedParameters(): Readonly<Record<string, unknown>> {
    this.assertOpen();
    const values = this.settings.getAllGlobalSettings();
    if ('streaming' in values) {
      const normalized = this.readNamedParameter('streaming');
      if (normalized !== undefined) values.streaming = normalized;
    }
    return values;
  }
  initializeProviderSelection(
    provider: string | undefined,
    model: string,
  ): void {
    this.assertOpen();
    if (
      this.readSelectedProvider() !== undefined ||
      provider === undefined ||
      provider === UNCONFIGURED_PROVIDER ||
      provider.length === 0
    )
      return;
    this.settings.set('activeProvider', provider);
    const selectedModel = this.settings.getProviderSettings(provider).model;
    if (typeof selectedModel !== 'string' || selectedModel.length === 0)
      this.settings.setProviderSetting(provider, 'model', model);
  }

  readSubagentRunPolicy(): SubagentRunPolicy {
    this.assertOpen();
    const turns = this.settings.get('maxTurnsPerPrompt');
    const output = this.settings.get('subagent-max-output-tokens-total');
    const validTurns = typeof turns === 'number' && Number.isFinite(turns);
    const validOutput = typeof output === 'number' && Number.isFinite(output);
    return Object.freeze({
      maxTurnsPerPrompt:
        validTurns && (turns === -1 || turns > 0) ? turns : undefined,
      maxOutputTokensTotal:
        validOutput && (output === -1 || output >= 0) ? output : undefined,
    });
  }

  readRecordingQueueLimit(constructionLimit: number): number {
    this.assertOpen();
    const value = this.settings.get('session-recording-queue-max-bytes');
    if (value === undefined) return constructionLimit;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      throw new Error(
        'session-recording-queue-max-bytes must be a non-negative safe integer',
      );
    return value;
  }

  readTaskPolicy(): TaskExecutionPolicy {
    this.assertOpen();
    return Object.freeze({
      'task-default-timeout-seconds': this.settings.get(
        'task-default-timeout-seconds',
      ),
      'task-max-timeout-seconds': this.settings.get('task-max-timeout-seconds'),
      globalAsyncEnabled: this.settings.get('subagents.asyncEnabled') !== false,
      profileAsyncEnabled:
        this.settings.get('subagents.async.enabled') !== false,
    });
  }

  createChildStore(): SettingsService {
    this.assertOpen();
    return new SettingsService({ sessionSource: this.settings });
  }

  readSessionOverride(key: string): unknown {
    this.assertOpen();
    return this.settings.getSessionScoped(assertSessionScopedKey(key));
  }

  writeSessionOverride(key: string, value: unknown): void {
    this.assertOpen();
    this.settings.setSessionScoped(key, value);
  }

  clearSessionOverride(key: string): void {
    this.assertOpen();
    this.settings.clearSessionScoped(key);
  }

  async writeToolFormat(format: string): Promise<void> {
    this.assertOpen();
    const provider = this.readSelectedProvider();
    if (provider === undefined)
      throw new Error('No active provider is configured.');
    await this.settings.updateSettings(provider, { toolFormat: format });
    this.writeUserParameter('toolFormat', format);
  }

  readToolFormat(): unknown {
    this.assertOpen();
    const provider = this.readSelectedProvider();
    return provider === undefined
      ? undefined
      : this.settings.getProviderSettings(provider).toolFormat;
  }

  readSelectedProvider(): string | undefined {
    this.assertOpen();
    const provider = this.settings.get('activeProvider');
    return typeof provider === 'string' && provider.length > 0
      ? provider
      : undefined;
  }

  readSelectedEndpoint(): string | undefined {
    this.assertOpen();
    const provider = this.readSelectedProvider();
    const value =
      this.settings.get('base-url') ??
      (provider === undefined
        ? undefined
        : this.settings.getProviderSettings(provider)['base-url']);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  readSelectedModel(): string | undefined {
    this.assertOpen();
    const provider = this.settings.get('activeProvider');
    if (typeof provider !== 'string' || provider.length === 0) return undefined;
    const stored = this.settings.getProviderSettings(provider).model;
    const selected = this.selectedModels.get(provider);
    const model =
      selected !== undefined && selected.observed === stored
        ? selected.model
        : stored;
    if (typeof model !== 'string' || model.length === 0) {
      this.selectedModels.delete(provider);
      return undefined;
    }
    this.selectedModels.set(provider, { model, observed: stored });
    return model;
  }

  selectModel(
    model: string,
    defaults: {
      readonly departing: Readonly<Record<string, unknown>>;
      readonly arriving: Readonly<Record<string, unknown>>;
    },
  ): void {
    this.chooseModel(model);
    const owned = this.defaults.getModelDefaultOwnedKeys();
    const providerDefaults = this.defaults.getProviderDefaultOwnedEntries();
    for (const key of Object.keys(defaults.departing)) {
      if (!(key in defaults.arriving) && owned.has(key))
        this.writeNamedParameter(key, providerDefaults.get(key));
    }
    const applied: string[] = [];
    for (const [key, value] of Object.entries(defaults.arriving)) {
      if (
        this.readNamedParameter(key) === undefined ||
        owned.has(key) ||
        providerDefaults.has(key)
      ) {
        this.writeNamedParameter(key, value);
        applied.push(key);
      }
    }
    this.defaults.recordModelDefaultOwnedKeys(applied);
  }

  chooseModel(model: string): void {
    this.assertOpen();
    const provider = this.settings.get('activeProvider');
    if (typeof provider !== 'string' || provider.length === 0)
      throw new Error('Model selection requires an active provider');
    this.settings.selectSessionModel(provider, model, this);
    this.selectedModels.set(provider, { model, observed: model });
  }

  writeUserParameter(key: string, value: unknown): void {
    this.writeNamedParameter(key, value);
    if (value === undefined) this.defaults.releaseEphemeralOwnership(key);
    else this.defaults.markEphemeralUserOwned(key);
  }

  checkpointDefaults(): () => void {
    this.assertOpen();
    return this.defaults.checkpoint();
  }

  isUserParameter(key: string): boolean {
    this.assertOpen();
    return this.defaults.isEphemeralUserOwned(key);
  }

  recordProviderDefaults(entries: Iterable<readonly [string, unknown]>): void {
    this.assertOpen();
    this.defaults.recordProviderDefaultOwnedEntries(entries);
  }

  recordModelDefaults(keys: Iterable<string>): void {
    this.assertOpen();
    this.defaults.recordModelDefaultOwnedKeys(keys);
  }

  captureDefaultClassification(): Readonly<{
    modelKeys: readonly string[];
    providerEntries: ReadonlyArray<readonly [string, unknown]>;
  }> {
    this.assertOpen();
    return Object.freeze({
      modelKeys: Object.freeze([...this.defaults.getModelDefaultOwnedKeys()]),
      providerEntries: Object.freeze(
        structuredClone([...this.defaults.getProviderDefaultOwnedEntries()]),
      ),
    });
  }

  captureUserParameters(): Readonly<Record<string, unknown>> {
    this.assertOpen();
    const models = this.defaults.getModelDefaultOwnedKeys();
    const providers = this.defaults.getProviderDefaultOwnedEntries();
    return captureUserSettings(
      this.captureNamedParameters(),
      new Set([...models, ...providers.keys()]),
    );
  }

  private publicationPending = false;

  beginModelPublication(): { commit: () => void; rollback: () => void } {
    this.assertOpen();
    if (this.publicationPending)
      throw new Error('Model publication is already pending');
    const previous = this.readSelectedModel();
    this.publicationPending = true;
    return {
      commit: () => {
        this.publicationPending = false;
        const current = this.readSelectedModel();
        if (current !== undefined && current !== previous)
          coreEvents.emitModelChanged(current);
      },
      rollback: () => {
        this.publicationPending = false;
      },
    };
  }

  setAllowedTools(names: readonly string[]): void {
    this.assertOpen();
    this.settings.set('tools.allowed', [...names]);
  }

  readLoopDetectionPolicy(): LoopDetectionPolicy {
    this.assertOpen();
    const number = (key: string): number | undefined => {
      const value = this.settings.get(key);
      return typeof value === 'number' ? value : undefined;
    };
    const enabled = this.settings.get('loopDetectionEnabled');
    return Object.freeze({
      loopDetectionEnabled: typeof enabled === 'boolean' ? enabled : undefined,
      maxTurnsPerPrompt: number('maxTurnsPerPrompt'),
      toolCallLoopThreshold: number('toolCallLoopThreshold'),
      contentLoopThreshold: number('contentLoopThreshold'),
    });
  }

  readToolExecutionPolicy(): ToolExecutionPolicy {
    this.assertOpen();
    return Object.freeze({
      'shell-replacement': this.settings.get('shell-replacement'),
      'shell-output-retention-max-bytes': this.settings.get(
        'shell-output-retention-max-bytes',
      ),
      'shell-inactivity-timeout-seconds': this.settings.get(
        'shell-inactivity-timeout-seconds',
      ),
      emojifilter: this.settings.get('emojifilter'),
      'file-read-max-lines': this.settings.get('file-read-max-lines'),
      'tool-output-max-items': this.settings.get('tool-output-max-items'),
      'tool-output-max-tokens': this.settings.get('tool-output-max-tokens'),
      'tool-output-truncate-mode': this.settings.get(
        'tool-output-truncate-mode',
      ),
      'tool-output-item-size-limit': this.settings.get(
        'tool-output-item-size-limit',
      ),
      'max-image-dimension': this.settings.get('max-image-dimension'),
      'max-image-pixels': this.settings.get('max-image-pixels'),
      'image-resize.enabled': this.settings.get('image-resize.enabled'),
      'image-resize.maxLongEdge': this.settings.get('image-resize.maxLongEdge'),
      'image-resize.maxShortEdge': this.settings.get(
        'image-resize.maxShortEdge',
      ),
      'image-resize.maxPixels': this.settings.get('image-resize.maxPixels'),
      'shell-default-timeout-seconds': this.settings.get(
        'shell-default-timeout-seconds',
      ),
      'shell-max-timeout-seconds': this.settings.get(
        'shell-max-timeout-seconds',
      ),
      'model.canSaveCore': this.settings.get('model.canSaveCore'),
    });
  }

  readRegistryPolicy(excluded: readonly string[]): RegistryPolicy {
    this.assertOpen();
    return assembleTaskSchemaPolicy(this.settings, excluded)();
  }

  private readClientToolPolicy(): Readonly<{
    allowed?: string[];
    disabled?: string[];
  }> {
    this.assertOpen();
    const list = (value: unknown): string[] | undefined =>
      Array.isArray(value)
        ? value
            .filter(
              (entry): entry is string =>
                typeof entry === 'string' && entry.trim().length > 0,
            )
            .map((entry) => entry.trim())
        : undefined;
    return Object.freeze({
      allowed: list(this.settings.get('tools.allowed')),
      disabled: list(this.settings.get('tools.disabled')),
    });
  }

  readToolGovernance(excluded: readonly string[]): ToolGovernance {
    this.assertOpen();
    return buildToolGovernance({
      getEphemeralSettings: () => ({
        'tools.allowed': this.settings.get('tools.allowed'),
        'tools.disabled': this.settings.get('tools.disabled'),
      }),
      getExcludeTools: () => [...excluded],
    });
  }

  closeAdmission(): void {
    this.closed = true;
    this.settings.off('provider-change', this.selectionChanged);
    this.selectedModels.clear();
    this.telemetryListeners.clear();
  }

  async dispose(): Promise<void> {
    this.closeAdmission();
    const outcomes = await Promise.allSettled([
      ...[...this.settingsSubscriptions].map((release) =>
        Promise.resolve().then(release),
      ),
      Promise.resolve().then(() =>
        this.ownsTelemetry ? this.telemetryRoot?.close() : undefined,
      ),
    ]);
    const failures = outcomes.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Session settings cleanup failed');
  }
}
