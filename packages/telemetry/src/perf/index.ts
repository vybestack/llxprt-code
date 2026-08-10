/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  PERF_SCHEMA_VERSION,
  PERF_RECORD_TYPE_OPERATION,
  PERF_RECORD_TYPE_MEMORY_SAMPLE,
  PERF_TERMINAL_STATUSES,
  PerfOperationRecordSchema,
  PerfMemorySampleRecordSchema,
  PerfRecordSchema,
  deriveOperationId,
  joinKeyFromPromptId,
  classifyPerfLine,
  parsePerfRecord,
  readPerfRecords,
  streamPerfRecords,
} from './perfRecords.js';
export type {
  PerfTerminalStatus,
  PerfOperationRecord,
  PerfMemorySampleRecord,
  PerfRecord,
  PerfLineClassification,
  PerfStreamEntry,
  PerfReaderCounts,
  PerfReaderResult,
} from './perfRecords.js';
export { PerfSink } from './PerfSink.js';
export type { PerfSinkOptions, PerfSinkFilesystem } from './PerfSink.js';

// Retention + claim lifecycle (P08, D3/D5/D6).
// The filesystem and scheduler port types are exported for the CLI composition
// root. The deterministic fault injector remains package-private to tests.
export {
  PERF_MAX_BYTES,
  PERF_MAX_FILES,
  PERF_MAINTENANCE_INTERVAL_MS,
  PERF_CLAIM_LEASE_MS,
  PERF_DIAG_RATE_LIMIT_MS,
  PerfRetention,
} from './retention.js';
export type { PerfRetentionOptions } from './retention.js';
export type { PerfRetentionFilesystem } from './retention.js';
export type { PerfScheduler, PerfTimerHandle } from './retention.js';

// Perf phase observer seam (P07). Default-off module-level subscription.
export {
  setPerfPhaseObserver,
  getPerfPhaseObserver,
} from './perfPhaseObserver.js';
export type {
  PerfPhaseObserver,
  PerfProviderAttemptStartInfo,
  PerfProviderAttemptEndInfo,
  PerfToolCallCompletedInfo,
} from './perfPhaseObserver.js';

// P11: directory consumer, report, inspect, delete, shared artifacts.
export { streamPerfDirectory, consumePerfDirectory } from './perfConsumer.js';
export type {
  PerfConsumerEntry,
  PerfConsumerCounts,
  PerfConsumerResult,
} from './perfConsumer.js';
export {
  buildReport,
  assembleReport,
  formatReport,
  joinTokenRowsByOperation,
} from './perfReport.js';
export type {
  PerfTokenUsageRow,
  ReportDimensions,
  ReportBuildIdentity,
  ReportFileMemorySlopes,
  ReportGroup,
  BaselineComparison,
  ReportGroupWithBaseline,
  ReportSelfHealth,
  ReportResult,
  P50MetricKey,
} from './perfReport.js';
export { perfInspect, formatInspect } from './perfInspect.js';
export type { PerfInspectResult, PerfSkippedCounts } from './perfInspect.js';
export { perfDelete, formatDeleteResult } from './perfDelete.js';
export type {
  PerfDeleteOptions,
  PerfDeleteResult,
  PerfDeleteFilesystem,
} from './perfDelete.js';

// D1 token-usage streaming and aggregation stay package-private. The report is
// the production API; same-package behavioral tests import the reader directly.
//
// Artifact parsing/protection functions are package-private (used only by
// PerfRetention and perfDelete within this package). Only the types that appear
// in public-facing signatures are exported.
export type {
  ParsedPerfFilename,
  ParsedClaimFilename,
  ParsedArtifactName,
  ClaimProtectionInput,
} from './perfArtifacts.js';

// P10/P11: canonical read-time memory slope derivation and types (owned below
// the CLI layer so the report and the live view share one algorithm).
export {
  derivePerOperationMemorySlope,
  derivePerMinuteMemorySlope,
} from './perfSlopeBridge.js';
export type {
  PerOperationMemorySlope,
  PerMinuteMemorySlope,
} from './perfSlopeBridge.js';
