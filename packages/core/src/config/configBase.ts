/**
 * ConfigBase — extends ConfigBaseCore with abstract methods and complex logic.
 * Simple field declarations and trivial accessors live in ConfigBaseCore.
 * Complex method implementations live in Config (extends ConfigBase) in config.ts.
 */

import { DebugLogger } from '../debug/DebugLogger.js';
import { TELEMETRY_OUTFILE_BOUND_DEFAULTS } from './configConstructor.js';
import type { LspConfig } from '@vybestack/llxprt-code-ide-integration';
import type { ShellReplacementMode } from './configTypes.js';
import { ConfigBaseCore } from './configBaseCore.js';
import type { ApprovalMode } from './configTypes.js';

export abstract class ConfigBase extends ConfigBaseCore {
  abstract getExcludeTools(): string[] | undefined;
  abstract setApprovalMode(mode: ApprovalMode): void;
  abstract getConversationLoggingEnabled(): boolean;

  getSessionId(): string {
    return this.adoptedSessionId ?? this.sessionId;
  }

  /**
   * @fix FIX-1336-SESSION-ADOPTION
   * Adopt a restored session's ID for use by TodoStore and other session-scoped services.
   * This allows --continue to properly restore todos from the previous session.
   */
  adoptSessionId(sessionId: string): void {
    const logger = new DebugLogger('llxprt:config:session');
    logger.debug(
      `adoptSessionId: adopting ${sessionId} (was ${this.sessionId})`,
    );
    this.adoptedSessionId = sessionId;
  }

  // #3315 outfile-bound telemetry getters. They read the protected
  // telemetrySettings field declared by ConfigBaseCore; sibling getters for
  // the older telemetry flags live there. Fallbacks share the exported
  // defaults constant with resolveTelemetrySettings so the two cannot drift.
  getTelemetryLogApiBodiesEnabled(): boolean {
    return (
      this.telemetrySettings.logApiBodies ??
      TELEMETRY_OUTFILE_BOUND_DEFAULTS.logApiBodies
    );
  }
  getTelemetryLogApiBodyMaxChars(): number {
    return (
      this.telemetrySettings.logApiBodyMaxChars ??
      TELEMETRY_OUTFILE_BOUND_DEFAULTS.logApiBodyMaxChars
    );
  }
  getTelemetryOutfileMaxBytes(): number {
    return (
      this.telemetrySettings.outfileMaxBytes ??
      TELEMETRY_OUTFILE_BOUND_DEFAULTS.outfileMaxBytes
    );
  }
  getTelemetryOutfileMaxFiles(): number {
    return (
      this.telemetrySettings.outfileMaxFiles ??
      TELEMETRY_OUTFILE_BOUND_DEFAULTS.outfileMaxFiles
    );
  }

  setDisabledHooks(hooks: string[]): void {
    this.disabledHooks = hooks;
  }

  getLspConfig(): LspConfig | undefined {
    return this.lspConfig === undefined
      ? undefined
      : structuredClone(this.lspConfig);
  }

  private resolveByteLimit(key: string, defaultValue: number): number {
    const value = this.initialSettings[key] ?? defaultValue;
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new Error(`${key} must be a non-negative safe integer`);
    }
    return value;
  }

  override getImagePayloadBudgetBytes(): number {
    return this.resolveByteLimit(
      'image-payload-budget-bytes',
      this.imagePayloadBudgetBytes,
    );
  }

  override getMediaStoreQuotaByteLimit(): number {
    return this.resolveByteLimit(
      'media-store-quota-bytes',
      super.getMediaStoreQuotaByteLimit(),
    );
  }

  override getSessionRecordingQueueByteLimit(): number {
    return this.resolveByteLimit(
      'session-recording-queue-max-bytes',
      super.getSessionRecordingQueueByteLimit(),
    );
  }

  override getSessionPersistenceQueueByteLimit(): number {
    return this.resolveByteLimit(
      'session-persistence-queue-max-bytes',
      super.getSessionPersistenceQueueByteLimit(),
    );
  }

  getShellReplacement(): ShellReplacementMode {
    return this.shellReplacement;
  }
}
