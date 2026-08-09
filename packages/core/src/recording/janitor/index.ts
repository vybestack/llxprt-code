/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Barrel export for the session-recording janitor module.
 */

export type {
  UserRetentionSettings,
  ResolvedRetentionConfig,
  SessionCandidate,
  SessionCleanupResult,
  CandidateKind,
} from './cleanupTypes.js';

export {
  DEFAULT_MAX_TOTAL_SIZE_MB,
  DEFAULT_MIN_RETENTION,
  parseRetentionPeriod,
  validateRetentionConfig,
  resolveRetentionConfig,
} from './retentionPolicy.js';

export {
  readSessionJsonlHeader,
  type SessionHeaderInfo,
} from './sessionHeaderReader.js';

export {
  scanGlobalSessions,
  ARCHIVE_DIR_NAME,
  type ScanResult,
} from './sessionScanner.js';

export { JanitorLease, type JanitorLeaseHandle } from './janitorLease.js';

export {
  compressToArchive,
  verifyArchiveIntegrity,
  computeFileHashAndSize,
  cleanupStaleTempArchives,
  type ArchiveResult,
  type VerifyResult,
} from './archiveCompressor.js';

export {
  runSessionCleanup,
  runSessionCleanupWithSettings,
  emptyResult,
  type SessionCleanupParams,
} from './sessionJanitor.js';

export {
  runReclamation,
  type ReclamationMetrics,
} from './reclamationEngine.js';

export {
  buildSessionGroups,
  evaluateGroupEligibility,
  compareGroupsOldestFirst,
  compareGroupsNewestFirst,
  type SessionGroup,
} from './sessionGrouping.js';
