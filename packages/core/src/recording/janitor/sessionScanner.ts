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

import type { Dirent, Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SessionCandidate } from './cleanupTypes.js';
import { readSessionJsonlHeader } from './sessionHeaderReader.js';

const PROJECT_HASH_RE = /^[0-9a-f]{64}$/;
export const ARCHIVE_DIR_NAME = 'archive';
const SESSION_PREFIX = 'session-';
const SESSION_JSONL_SUFFIX = '.jsonl';
const ARCHIVE_SUFFIX = '.jsonl.gz';

export interface SessionScanLimits {
  readonly maxProjects: number;
  readonly maxFiles: number;
  readonly maxCandidateBytes: number;
}

const DEFAULT_SCAN_LIMITS: SessionScanLimits = {
  maxProjects: 4096,
  maxFiles: 100_000,
  maxCandidateBytes: 16 * 1024 * 1024 * 1024,
};

export interface ScanResult {
  readonly candidates: readonly SessionCandidate[];
  readonly chatsDirs: readonly string[];
  readonly scanErrorCount: number;
  readonly scanSkippedCount: number;
}

interface ScanBudget {
  readonly limits: SessionScanLimits;
  files: number;
  bytes: number;
  skipped: number;
  errors: number;
  exhausted: boolean;
}

function hasErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === code
  );
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid session scan limit ${name}`);
  }
  return value;
}

function validatedLimits(limits: SessionScanLimits): SessionScanLimits {
  return {
    maxProjects: positiveLimit(limits.maxProjects, 'maxProjects'),
    maxFiles: positiveLimit(limits.maxFiles, 'maxFiles'),
    maxCandidateBytes: positiveLimit(
      limits.maxCandidateBytes,
      'maxCandidateBytes',
    ),
  };
}

function getFileSize(fileStat: Stats): number {
  const allocated =
    typeof fileStat.blocks === 'number' && fileStat.blksize > 0
      ? fileStat.blocks * 512
      : 0;
  return allocated > 0 ? allocated : fileStat.size;
}

function markBudgetExhausted(budget: ScanBudget): void {
  if (!budget.exhausted) {
    budget.exhausted = true;
    budget.skipped += 1;
  }
}

function candidateBudgetAtLimit(budget: ScanBudget): boolean {
  return (
    budget.exhausted ||
    budget.files >= budget.limits.maxFiles ||
    budget.bytes >= budget.limits.maxCandidateBytes
  );
}

function reserveCandidateBudget(fileStat: Stats, budget: ScanBudget): boolean {
  if (
    candidateBudgetAtLimit(budget) ||
    fileStat.size > budget.limits.maxCandidateBytes - budget.bytes
  ) {
    markBudgetExhausted(budget);
    return false;
  }
  budget.files += 1;
  budget.bytes += fileStat.size;
  return true;
}

function rawFileName(name: string): boolean {
  return (
    name.startsWith(SESSION_PREFIX) &&
    name.endsWith(SESSION_JSONL_SUFFIX) &&
    !name.endsWith(ARCHIVE_SUFFIX)
  );
}

function archiveFileName(name: string): boolean {
  return name.startsWith(SESSION_PREFIX) && name.endsWith(ARCHIVE_SUFFIX);
}

async function scanRawSessionEntry(
  entry: Dirent,
  chatsDir: string,
  projectHashDir: string,
  currentSessionId: string | undefined,
  budget: ScanBudget,
): Promise<SessionCandidate | undefined> {
  if (!entry.isFile() || !rawFileName(entry.name)) return undefined;
  const filePath = path.join(chatsDir, entry.name);
  try {
    const fileStat = await fs.lstat(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return undefined;
    if (!reserveCandidateBudget(fileStat, budget)) return undefined;
    const header = await readSessionJsonlHeader(filePath);
    return {
      kind: 'raw',
      filePath,
      fileName: entry.name,
      containerDir: chatsDir,
      projectHashDir,
      sessionId: header?.sessionId ?? null,
      isCurrentSession:
        header?.sessionId !== undefined &&
        currentSessionId !== undefined &&
        header.sessionId === currentSessionId,
      sizeBytes: getFileSize(fileStat),
      mtime: fileStat.mtime,
      dev: fileStat.dev,
      ino: fileStat.ino,
    };
  } catch {
    budget.errors += 1;
    return undefined;
  }
}

async function scanRawSessions(
  chatsDir: string,
  projectHashDir: string,
  currentSessionId: string | undefined,
  budget: ScanBudget,
): Promise<SessionCandidate[]> {
  const candidates: SessionCandidate[] = [];
  let directory: Awaited<ReturnType<typeof fs.opendir>>;
  try {
    directory = await fs.opendir(chatsDir);
  } catch (error) {
    if (!hasErrnoCode(error, 'ENOENT')) budget.errors += 1;
    return candidates;
  }
  try {
    for await (const entry of directory) {
      if (candidateBudgetAtLimit(budget)) {
        markBudgetExhausted(budget);
        break;
      }
      const candidate = await scanRawSessionEntry(
        entry,
        chatsDir,
        projectHashDir,
        currentSessionId,
        budget,
      );
      if (candidate !== undefined) candidates.push(candidate);
    }
  } catch (error) {
    if (!hasErrnoCode(error, 'ENOENT')) budget.errors += 1;
  }
  return candidates;
}

async function scanArchiveSessionEntry(
  entry: Dirent,
  archiveDir: string,
  projectHashDir: string,
  budget: ScanBudget,
): Promise<SessionCandidate | undefined> {
  if (!entry.isFile() || !archiveFileName(entry.name)) return undefined;
  const filePath = path.join(archiveDir, entry.name);
  try {
    const fileStat = await fs.lstat(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return undefined;
    if (!reserveCandidateBudget(fileStat, budget)) return undefined;
    return {
      kind: 'archive',
      filePath,
      fileName: entry.name,
      containerDir: archiveDir,
      projectHashDir,
      sessionId: null,
      isCurrentSession: false,
      sizeBytes: getFileSize(fileStat),
      mtime: fileStat.mtime,
      dev: fileStat.dev,
      ino: fileStat.ino,
    };
  } catch {
    budget.errors += 1;
    return undefined;
  }
}

async function scanArchiveSessions(
  archiveDir: string,
  projectHashDir: string,
  budget: ScanBudget,
): Promise<SessionCandidate[]> {
  const candidates: SessionCandidate[] = [];
  if (budget.exhausted || candidateBudgetAtLimit(budget)) return candidates;
  try {
    const archiveStat = await fs.lstat(archiveDir);
    if (archiveStat.isSymbolicLink() || !archiveStat.isDirectory()) {
      return candidates;
    }
  } catch (error) {
    if (!hasErrnoCode(error, 'ENOENT')) budget.errors += 1;
    return candidates;
  }
  let directory: Awaited<ReturnType<typeof fs.opendir>>;
  try {
    directory = await fs.opendir(archiveDir);
  } catch (error) {
    if (!hasErrnoCode(error, 'ENOENT')) budget.errors += 1;
    return candidates;
  }
  try {
    for await (const entry of directory) {
      if (candidateBudgetAtLimit(budget)) {
        markBudgetExhausted(budget);
        break;
      }
      const candidate = await scanArchiveSessionEntry(
        entry,
        archiveDir,
        projectHashDir,
        budget,
      );
      if (candidate !== undefined) candidates.push(candidate);
    }
  } catch (error) {
    if (!hasErrnoCode(error, 'ENOENT')) budget.errors += 1;
  }
  return candidates;
}
async function validatedChatsDirectory(
  globalTempDir: string,
  projectName: string,
  budget: ScanBudget,
): Promise<string | undefined> {
  const projectPath = path.join(globalTempDir, projectName);
  const chatsDir = path.join(projectPath, 'chats');
  try {
    const projectStat = await fs.lstat(projectPath);
    if (projectStat.isSymbolicLink() || !projectStat.isDirectory()) {
      return undefined;
    }
    const chatsStat = await fs.lstat(chatsDir);
    if (chatsStat.isSymbolicLink() || !chatsStat.isDirectory()) {
      return undefined;
    }
    return chatsDir;
  } catch (error) {
    if (!hasErrnoCode(error, 'ENOENT')) budget.errors += 1;
    return undefined;
  }
}

async function appendProjectSessions(
  globalTempDir: string,
  projectName: string,
  currentSessionId: string | undefined,
  budget: ScanBudget,
  candidates: SessionCandidate[],
  chatsDirs: string[],
): Promise<void> {
  const chatsDir = await validatedChatsDirectory(
    globalTempDir,
    projectName,
    budget,
  );
  if (chatsDir === undefined) return;
  chatsDirs.push(chatsDir);
  candidates.push(
    ...(await scanRawSessions(chatsDir, projectName, currentSessionId, budget)),
  );
  if (budget.exhausted) return;
  candidates.push(
    ...(await scanArchiveSessions(
      path.join(chatsDir, ARCHIVE_DIR_NAME),
      projectName,
      budget,
    )),
  );
}
function projectBudgetAtLimit(projects: number, budget: ScanBudget): boolean {
  if (projects < budget.limits.maxProjects && !budget.exhausted) return false;
  if (!budget.exhausted) budget.skipped += 1;
  return true;
}

/**
 * Scan session recordings sequentially under explicit candidate and byte limits.
 *
 * @param globalTempDir - Global session temporary directory.
 * @param currentSessionId - Session identifier that must be marked active.
 * @param limits - Finite project, file, and aggregate-byte bounds.
 * @returns Candidates, discovered chats directories, errors, and skipped entries.
 */
export async function scanGlobalSessions(
  globalTempDir: string,
  currentSessionId?: string,
  limits: SessionScanLimits = DEFAULT_SCAN_LIMITS,
): Promise<ScanResult> {
  const budget: ScanBudget = {
    limits: validatedLimits(limits),
    files: 0,
    bytes: 0,
    skipped: 0,
    errors: 0,
    exhausted: false,
  };
  const candidates: SessionCandidate[] = [];
  const chatsDirs: string[] = [];
  let projects = 0;
  let directory: Awaited<ReturnType<typeof fs.opendir>>;
  try {
    directory = await fs.opendir(globalTempDir);
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return {
        candidates,
        chatsDirs,
        scanErrorCount: 0,
        scanSkippedCount: 0,
      };
    }
    throw error;
  }
  for await (const entry of directory) {
    if (PROJECT_HASH_RE.test(entry.name)) {
      if (projectBudgetAtLimit(projects, budget)) break;
      projects += 1;
      await appendProjectSessions(
        globalTempDir,
        entry.name,
        currentSessionId,
        budget,
        candidates,
        chatsDirs,
      );
    }
  }
  return {
    candidates,
    chatsDirs,
    scanErrorCount: budget.errors,
    scanSkippedCount: budget.skipped,
  };
}
