/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Profile } from './types.js';
import { isLoadBalancerProfile } from './types.js';
import { parseProfile } from '../settings/validation.js';
import {
  hasErrnoCode,
  acquireProfilesLockSync,
  readProfileFileSync,
  uniqueTempPath,
  fsyncDirSync,
} from './profileStore.js';

/**
 * The virtual provider name that indicates a corrupt standard profile
 * (issue #2479/#2477). Before commit 2d97afdb0, `/profile save` during an
 * active load-balancer session wrote a STANDARD profile with this provider.
 * Such a profile can never be re-applied because 'load-balancer' is not a
 * registered provider at load time.
 */
export const CORRUPT_PROVIDER = 'load-balancer';

const REPAIR_BACKUP_SUFFIX = '.pre-repair.bak';

/**
 * Discriminated result of {@link repairCanonicalProfiles}.
 * - 'repaired': exactly one profile was repaired without errors.
 * - 'none': no candidates found, no repair needed.
 * - 'busy': lock was busy, repair deferred (no marker should be written).
 * - 'error': a repair preflight or commit failed (error marker semantics).
 *
 * The function repairs at most one sorted candidate so the mutation boundary
 * is one atomic rename and never reports 'repaired' together with errors.
 */
export type CanonicalRepairOutcome =
  | {
      readonly kind: 'repaired';
      readonly profilesRepaired: number;
    }
  | { readonly kind: 'none' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'error'; readonly errors: readonly string[] };

/**
 * @deprecated Use {@link CanonicalRepairOutcome} instead. This type is
 *             preserved solely for package-root API compatibility with
 *             consumers that imported the older non-discriminated result
 *             shape. It is not used internally.
 */
export type CanonicalRepairResult = {
  readonly profilesRepaired: number;
  readonly errors: readonly string[];
};

/**
 * Structural guard for a raw parsed profile object (the JSON-parsed value
 * before it goes through parseProfile). Used to inspect the `type` field
 * directly on the raw object so that eligibility does not depend on the
 * typed Profile narrowing (#3).
 */
function isRawObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Determine whether a RAW parsed JSON object matches the known historical
 * defect signature (issue #2479/#2477). This is the single conservative
 * structural predicate used by both the canonical scan and the replacement
 * validation. Inspects the raw object directly to ensure eligibility is
 * exact (#3):
 *
 * - `type` must be ABSENT (not 'loadbalancer' and not 'standard'). The
 *   corrupt shape never carried a type field.
 * - `provider` must be exactly {@link CORRUPT_PROVIDER} ('load-balancer').
 * - `version` must be exactly 1.
 * - `modelParams` must be absent or an empty object — the historical defect
 *   always had empty modelParams.
 * - `ephemeralSettings` must be an empty object — the historical defect
 *   always had empty ephemeralSettings.
 * - Must parse as a valid standard v1 profile via parseProfile (not an LB).
 *
 * This is deliberately conservative: a genuine loadbalancer profile
 * (type='loadbalancer') is NEVER corrupt. A standard profile with nonempty
 * modelParams or ephemeralSettings is manually-authored and NOT the defect.
 * The model value is NOT constrained — the corruption is structural, so any
 * fallback model in this shape is corrupt.
 *
 * @param rawParsed The JSON-parsed raw object (NOT a typed Profile).
 */
export function isCorruptStandardProfileFromRaw(rawParsed: unknown): boolean {
  if (!isRawObject(rawParsed)) {
    return false;
  }
  // type must be ABSENT — the corrupt shape never had a type field (#3).
  if ('type' in rawParsed) {
    return false;
  }
  const provider = rawParsed['provider'];
  if (typeof provider !== 'string' || provider !== CORRUPT_PROVIDER) {
    return false;
  }
  if (rawParsed['version'] !== 1) {
    return false;
  }
  const modelParams = rawParsed['modelParams'];
  if (
    modelParams !== undefined &&
    (!isRawObject(modelParams) || Object.keys(modelParams).length !== 0)
  ) {
    return false;
  }
  const ephemeralSettings = rawParsed['ephemeralSettings'];
  if (
    !isRawObject(ephemeralSettings) ||
    Object.keys(ephemeralSettings).length !== 0
  ) {
    return false;
  }
  // Validate it parses as a standard v1 profile (not an LB, not garbage).
  let profile: Profile;
  try {
    profile = parseProfile(rawParsed);
  } catch {
    return false;
  }
  if (isLoadBalancerProfile(profile)) {
    return false;
  }
  return true;
}

/**
 * Read a profile JSON file, parse it, and return a typed result. Used by
 * the repair scan to determine if a canonical profile is corrupt.
 */
function readAndParseProfile(filePath: string):
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'parsed';
      readonly profile: Profile;
      readonly raw: string;
      readonly rawParsed: unknown;
    }
  | { readonly kind: 'invalid-json' }
  | { readonly kind: 'error'; readonly error: Error } {
  const result = readProfileFileSync(filePath);
  if (result.kind === 'absent') {
    return { kind: 'absent' };
  }
  if (result.kind === 'error') {
    return { kind: 'error', error: result.error };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    return { kind: 'invalid-json' };
  }
  let profile: Profile;
  try {
    profile = parseProfile(parsed);
  } catch {
    return { kind: 'invalid-json' };
  }
  return { kind: 'parsed', profile, raw: result.content, rawParsed: parsed };
}

/**
 * A candidate repair: a corrupt canonical profile that has a valid same-name
 * legacy replacement available.
 */
interface RepairCandidate {
  readonly name: string;
  readonly canonicalPath: string;
  readonly canonicalRaw: string;
  readonly replacement: string;
}

/**
 * Determine if a legacy file is a valid replacement for a corrupt canonical.
 * The legacy profile is eligible iff:
 * - It parses as a valid standard profile (not invalid JSON, not garbage).
 * - It is NOT a genuine loadbalancer profile.
 * - It does NOT itself match the corrupt structural signature.
 *
 * There are NO restrictions on provider, model, base-url, auth-key, or
 * context-limit — any valid standard profile that is not itself corrupt is
 * an acceptable replacement.
 *
 * Returns the serialized replacement JSON (with modelParams normalized so
 * absent becomes {}), or null if the legacy is not a valid replacement.
 */
function validateLegacyReplacement(legacyPath: string): string | null {
  const result = readProfileFileSync(legacyPath);
  if (result.kind !== 'content') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    return null;
  }

  if (!isRawObject(parsed)) {
    return null;
  }
  // A loadbalancer legacy is not a valid standard replacement.
  if (parsed['type'] === 'loadbalancer') {
    return null;
  }

  let profile: Profile;
  try {
    profile = parseProfile(parsed);
  } catch {
    return null;
  }
  if (isLoadBalancerProfile(profile)) {
    return null;
  }
  // The replacement must not itself match the corrupt structural signature.
  if (isCorruptStandardProfileFromRaw(parsed)) {
    return null;
  }
  // Reject any standard profile whose provider is the virtual non-loadable
  // 'load-balancer'. Such a profile cannot be loaded at runtime (no
  // registered provider), so replacing one non-loadable profile with
  // another is not a repair. This catches shapes that escape the narrow
  // canonical corrupt signature (e.g. nonempty modelParams).
  if (profile.provider === CORRUPT_PROVIDER) {
    return null;
  }

  // Serialize the normalized Profile returned by parseProfile so absent
  // modelParams becomes {} at the shared parse boundary. This produces
  // canonical bytes regardless of whether the legacy source omitted
  // modelParams.
  return JSON.stringify(profile, null, 2);
}

/**
 * Scan canonical profile files for corrupt standard profiles and match each
 * against a valid same-name legacy replacement.
 */
function collectRepairCandidates(
  canonicalFiles: readonly string[],
  canonicalDir: string,
  legacyProfilesDir: string,
  errors: string[],
): RepairCandidate[] {
  const candidates: RepairCandidate[] = [];
  for (const file of canonicalFiles) {
    const candidate = examineProfileForRepair(
      file,
      canonicalDir,
      legacyProfilesDir,
    );
    if (candidate.error !== undefined) {
      errors.push(candidate.error);
    }
    if (candidate.candidate !== undefined) {
      candidates.push(candidate.candidate);
    }
  }
  return candidates;
}

/**
 * Examine a single canonical profile file for repair candidacy.
 * Returns the candidate if corrupt+replaceable, or an error string.
 *
 * Any profile name is eligible — there is no hardcoded name restriction.
 */
function examineProfileForRepair(
  file: string,
  canonicalDir: string,
  legacyProfilesDir: string,
): { readonly candidate?: RepairCandidate; readonly error?: string } {
  const name = file.slice(0, -5);
  const canonicalPath = path.join(canonicalDir, file);

  const canonical = readAndParseProfile(canonicalPath);
  if (canonical.kind === 'error') {
    return { error: `profiles repair: ${String(canonical.error)}` };
  }
  if (canonical.kind !== 'parsed') {
    return {};
  }
  // Eligibility: inspect the raw parsed object for the structural signature.
  if (!isCorruptStandardProfileFromRaw(canonical.rawParsed)) {
    return {};
  }

  const legacyPath = path.join(legacyProfilesDir, file);
  const replacement = validateLegacyReplacement(legacyPath);
  if (replacement === null) {
    return {};
  }

  return {
    candidate: {
      name,
      canonicalPath,
      canonicalRaw: canonical.raw,
      replacement,
    },
  };
}

type VerifyResult =
  | { readonly kind: 'repair' }
  | { readonly kind: 'skip' }
  | { readonly kind: 'error'; readonly error: Error };

function verifyCanonicalUnchanged(candidate: RepairCandidate): VerifyResult {
  const current = readProfileFileSync(candidate.canonicalPath);
  if (current.kind === 'absent') {
    return { kind: 'skip' };
  }
  if (current.kind === 'error') {
    return { kind: 'error', error: current.error };
  }
  return current.content === candidate.canonicalRaw
    ? { kind: 'repair' }
    : { kind: 'skip' };
}

function repairOneCandidate(candidate: RepairCandidate): boolean {
  const verification = verifyCanonicalUnchanged(candidate);
  if (verification.kind === 'skip') {
    return false;
  }
  if (verification.kind === 'error') {
    throw verification.error;
  }

  const dir = path.dirname(candidate.canonicalPath);
  const base = path.basename(candidate.canonicalPath);
  let mode = 0o644;
  try {
    mode = fs.statSync(candidate.canonicalPath).mode & 0o777;
  } catch {
    // Preserve the historical default when the mode cannot be read.
  }

  const tempPath = writeReplacementTemp(dir, base, candidate.replacement, mode);
  try {
    validateReplacementFile(tempPath);
    claimBackup(candidate.canonicalPath, dir, base);
    fs.renameSync(tempPath, candidate.canonicalPath);
    fsyncDirSync(dir);
    return true;
  } catch (error) {
    const errors: unknown[] = [error];
    try {
      cleanupTemp(tempPath);
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'profile repair failed');
    }
    throw error;
  }
}

/** Write and fsync an exclusive same-directory replacement temp file. */
function writeReplacementTemp(
  dir: string,
  base: string,
  content: string,
  mode: number,
): string {
  const tmpPath = uniqueTempPath(dir, base, '.repair.tmp');
  try {
    fs.writeFileSync(tmpPath, content, {
      encoding: 'utf-8',
      mode,
      flag: 'wx',
    });
    // fsync the temp so the replacement content is durable before commit.
    fsyncFile(tmpPath);
  } catch (error) {
    cleanupTemp(tmpPath);
    throw error;
  }
  return tmpPath;
}

function fsyncFile(filePath: string): void {
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function cleanupTemp(tmpPath: string): void {
  try {
    fs.unlinkSync(tmpPath);
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
  fsyncDirSync(path.dirname(tmpPath));
}

function validateReplacementFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(content);
  // The replacement must not still match the corrupt structural signature.
  if (isCorruptStandardProfileFromRaw(parsed)) {
    throw new Error('replacement file still has the corrupt defect signature');
  }
}

/**
 * Claim an exclusive backup of the corrupt canonical file using
 * COPYFILE_EXCL. If the primary backup name is taken, try numbered
 * alternatives. The backup file and parent directory are fsync'd.
 */
function claimBackup(
  canonicalPath: string,
  dir: string,
  baseFileName: string,
): string {
  const primary = path.join(dir, `${baseFileName}${REPAIR_BACKUP_SUFFIX}`);
  try {
    fs.copyFileSync(canonicalPath, primary, fs.constants.COPYFILE_EXCL);
    fsyncFile(primary);
    fsyncDirSync(dir);
    return primary;
  } catch (error) {
    if (!hasErrnoCode(error, 'EEXIST')) {
      throw error;
    }
  }
  const maxBackupAttempts = 1000;
  for (let counter = 1; counter <= maxBackupAttempts; counter++) {
    const next = path.join(
      dir,
      `${baseFileName}.${counter}${REPAIR_BACKUP_SUFFIX}`,
    );
    try {
      fs.copyFileSync(canonicalPath, next, fs.constants.COPYFILE_EXCL);
      fsyncFile(next);
      fsyncDirSync(dir);
      return next;
    } catch (error) {
      if (!hasErrnoCode(error, 'EEXIST')) {
        throw error;
      }
    }
  }
  throw new Error(`could not claim a backup for ${canonicalPath}`);
}

/**
 * Cohesive settings-owned API for repairing corrupt canonical profiles.
 *
 * Scans canonical profile files for the known historical defect signature
 * (untyped standard-v1 profile whose provider is the virtual non-loadable
 * provider 'load-balancer', with empty modelParams and empty
 * ephemeralSettings, from issue #2479/#2477) and replaces one deterministic
 * candidate with its valid same-name legacy profile. Repairing at most one
 * profile per startup keeps the mutation boundary to one atomic rename;
 * later startups repair any remaining candidates.
 *
 * The corruption signature is structural and conservative: it does not
 * depend on a specific profile name, provider, model, endpoint, or auth
 * setting. A same-name legacy replacement is eligible iff it parses as a
 * valid standard profile, is not a genuine loadbalancer, and does not
 * itself match the corrupt structural signature.
 *
 * Composability (#4): repair and migration are separate operations. The
 * existing canonical no-overwrite publication (hard-link/COPYFILE_EXCL) and
 * the repair lock-before-scan make interleaving benign. A writer between
 * the migration and repair phases simply becomes the canonical input to
 * repair; the exact signature/byte checks protect against stale
 * replacement. No startup-wide lock is needed because no invariant spans
 * both operations.
 *
 * The repair marker is an audit record only. Callers must scan on every
 * startup because another eligible legacy source can appear later. A busy lock
 * remains a benign deferral to the next startup.
 *
 * Manual recovery safety (#3): the lock is released by removing only the
 * artifact whose owner token matches this process. A SIGKILL'd process
 * leaves a stale lock requiring explicit manual removal. Manual recovery is
 * supported ONLY after stopping all possible LLxprt/profile owner processes.
 * The token check is an accidental guard, NOT a guarantee that release is
 * safe against external replacement — unlink/recreate whilst the owner is
 * live is unsupported external interference.
 *
 * @param canonicalProfilesDir The canonical profiles directory
 *                             (e.g. configDir/profiles).
 * @param legacyProfilesDir    The legacy profiles directory
 *                             (e.g. legacyDir/profiles).
 * @returns A discriminated outcome.
 */
export function repairCanonicalProfiles(
  canonicalProfilesDir: string,
  legacyProfilesDir: string,
): CanonicalRepairOutcome {
  // Acquire the repair lock ONCE before any scanning or mutation (#7).
  // If busy before any mutation, defer benignly — no marker, no warning.
  let lock: ReturnType<typeof acquireProfilesLockSync>;
  try {
    lock = acquireProfilesLockSync(canonicalProfilesDir);
  } catch (error) {
    if (error instanceof Error && error.name === 'LockBusyError') {
      return { kind: 'busy' };
    }
    return {
      kind: 'error',
      errors: [`profiles repair lock error: ${String(error)}`],
    };
  }

  try {
    return repairCanonicalProfilesLocked(
      canonicalProfilesDir,
      legacyProfilesDir,
    );
  } finally {
    lock.release();
  }
}

/** Lock-held repair of at most one deterministic candidate. */
function repairCanonicalProfilesLocked(
  canonicalProfilesDir: string,
  legacyProfilesDir: string,
): CanonicalRepairOutcome {
  // Snapshot canonical file names AFTER lock acquisition so a concurrent
  // writer that creates new files cannot add candidates mid-scan (#7).
  let preExistingFiles: string[];
  try {
    preExistingFiles = fs
      .readdirSync(canonicalProfilesDir)
      .filter((f) => f.endsWith('.json'));
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      // Canonical profiles dir does not exist — no candidates, no repair.
      return { kind: 'none' };
    }
    return {
      kind: 'error',
      errors: [`profiles repair error: ${String(error)}`],
    };
  }

  const errors: string[] = [];
  const candidates = collectRepairCandidates(
    preExistingFiles,
    canonicalProfilesDir,
    legacyProfilesDir,
    errors,
  );

  candidates.sort((left, right) => left.name.localeCompare(right.name));
  if (candidates.length === 0) {
    return errors.length === 0 ? { kind: 'none' } : { kind: 'error', errors };
  }

  // If scan/preflight errors exist alongside a repair candidate, do NOT
  // mutate anything. Return error before repair so the caller sees the
  // problem and no partial state is committed.
  if (errors.length > 0) {
    return { kind: 'error', errors };
  }

  try {
    const repaired = repairOneCandidate(candidates[0]);
    if (repaired) {
      return { kind: 'repaired', profilesRepaired: 1 };
    }
    return errors.length === 0 ? { kind: 'none' } : { kind: 'error', errors };
  } catch (error) {
    return {
      kind: 'error',
      errors: [...errors, `profiles repair failed: ${String(error)}`],
    };
  }
}
