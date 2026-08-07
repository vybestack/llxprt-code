/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TelemetryConfig } from '@vybestack/llxprt-code-telemetry/telemetry/types.js';

/**
 * Narrow capability interfaces over core's `Config`.
 *
 * Each names the members one use case reads, so a consumer depends on one to
 * three members rather than the ~349 the compiler reports on `Config`. Core's
 * `Config` satisfies each structurally, so composition roots keep passing it
 * and nothing moves at runtime.
 *
 * Not exported from the package root: these are consumer-owned use-case
 * contracts. Publishing them would rebuild a god-object out of whatever the
 * package collectively needs. Add an interface per use case rather than
 * widening one to fit an unrelated caller.
 *
 * Part of the #2615 Config decomposition.
 */

import type { BucketFailoverHandler } from '@vybestack/llxprt-code-core/config/configTypes.js';

/** Reads a single ephemeral (session-scoped) setting. */
export interface EphemeralSettingReader {
  getEphemeralSetting(key: string): unknown;
}

/** Writes a single ephemeral setting. */
export interface EphemeralSettingWriter {
  setEphemeralSetting(key: string, value: unknown): void;
}

/** Reads and writes ephemeral settings. */
export interface EphemeralSettingsAccess
  extends EphemeralSettingReader,
    EphemeralSettingWriter {}

/** Installs the handler invoked when a provider bucket fails over. */
export interface BucketFailoverRegistrar {
  setBucketFailoverHandler(handler: BucketFailoverHandler | undefined): void;
}

/** Reads the active model and provider names. */
export interface ActiveModelSource {
  getModel(): string;
  getProvider(): string | undefined;
}

/** Reads the active provider and ephemeral settings. */
export interface ProviderSettingsAccess extends EphemeralSettingsAccess {
  getProvider(): string | undefined;
}

/**
 * What the conversation-logging path needs: the telemetry surface these
 * helpers forward into, plus the log destination.
 *
 * Sixteen members rather than the ~349 on Config. TelemetryConfig is telemetry's
 * own declared contract, so extending it keeps the forwarded calls type-safe
 * instead of relying on Config happening to satisfy them.
 */
export interface ConversationLogWriterConfig extends TelemetryConfig {
  getConversationLogPath(): string;
}
