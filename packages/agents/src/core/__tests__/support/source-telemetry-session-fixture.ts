/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  FileMetricExporter,
  FileSpanExporter,
} from '@vybestack/llxprt-code-telemetry/telemetry/file-exporters.js';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { captureProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';

export interface TelemetryPrivacy {
  readonly logPrompts: boolean;
  readonly logConversations: boolean;
  readonly logApiBodies: boolean;
  readonly maxChars: number;
}

type LogTransport = ReturnType<
  NonNullable<Parameters<typeof RootTelemetry.prepare>[1]>
>['logger'];

export interface TelemetrySessionInput {
  readonly root: string;
  readonly telemetryPath: string;
  readonly privacy: TelemetryPrivacy;
  readonly settingsService: ConstructorParameters<
    typeof SessionSettingsOwner
  >[0];
  readonly provider: Parameters<ProviderManager['registerProvider']>[0];
  readonly logger: LogTransport;
}

export interface TelemetrySession {
  readonly config: Config;
  readonly settingsOwner: SessionSettingsOwner;
  /** Prepared with the supplied exporter; callers enable it with initializeTelemetry. */
  readonly telemetry: RootTelemetry;
  readonly manager: ProviderManager;
  readonly diagnostics: ReturnType<typeof captureProviderRequestDiagnostics>;
}

/** A session-owned telemetry root, provider manager and request diagnostics over one exporter. */
export function createTelemetrySession(
  input: TelemetrySessionInput,
): TelemetrySession {
  const { root, telemetryPath, privacy, settingsService, provider } = input;
  const config = new Config({
    cwd: root,
    targetDir: root,
    sessionId: randomUUID(),
    model: 'gpt-5.6',
    debugMode: false,
    telemetry: {
      enabled: true,
      logPrompts: privacy.logPrompts,
      logApiBodies: privacy.logApiBodies,
      logApiBodyMaxChars: privacy.maxChars,
      logConversations: privacy.logConversations,
      conversationLogPath: root,
      outfile: telemetryPath,
    },
  });
  const settingsOwner = new SessionSettingsOwner(settingsService);
  const telemetryOptions = {
    enabled: true,
    sessionId: config.getSessionId(),
    outfile: telemetryPath,
    maxBytes: config.getTelemetryOutfileMaxBytes(),
    maxFiles: config.getTelemetryOutfileMaxFiles(),
    readPrivacySettings: () => privacy,
  };
  const telemetry = settingsOwner.bindTelemetry(
    config,
    RootTelemetry.prepare(telemetryOptions, () => ({
      tracer: new FileSpanExporter(telemetryPath, telemetryOptions),
      logger: input.logger,
      meter: new FileMetricExporter(telemetryPath, telemetryOptions),
    })),
  );
  const manager = new ProviderManager({
    config,
    settingsService,
    sessionSettings: settingsOwner,
  });
  manager.registerProvider(provider);
  const diagnostics = captureProviderRequestDiagnostics(
    config,
    settingsOwner,
    (name, usage) => manager.accumulateSessionTokens(name, usage),
  );
  return { config, settingsOwner, telemetry, manager, diagnostics };
}
