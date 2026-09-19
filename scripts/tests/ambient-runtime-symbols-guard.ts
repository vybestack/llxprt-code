#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Banned-symbol checker for issue #2616 (issue-workflow lane).
 *
 * Asserts the ambient mechanisms deleted by PR A stay deleted: the
 * module-level provider runtime context accessors, the settings runtime
 * adapter's ambient helpers, the provider runtime state factory, and the
 * settings package's process-wide singleton module. PR B adds the
 * AgentRuntimeState module-level globals: the write-only runtime state
 * registry, the subscription registry behind subscribeToAgentRuntimeState,
 * and the subscribe entry point itself. Production sources under
 * packages/<pkg>/src are scanned; test and spec files are excluded
 * (they may reference the names in deletion proofs).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const BANNED_AMBIENT_SYMBOLS = [
  'peekActiveProviderRuntimeContext',
  'setActiveProviderRuntimeContext',
  'clearActiveProviderRuntimeContext',
  'getActiveProviderRuntimeContext',
  'createSettingsProviderRuntimeContext',
  'setSettingsProviderRuntimeContext',
  'clearSettingsProviderRuntimeContext',
  'resolveRuntimeSettingsService',
  'getRuntimeSettingsService',
  'maybeGetRuntimeSettingsService',
  'activateSettingsRuntimeContext',
  'deactivateSettingsRuntimeContext',
  'registerSettingsService',
  'resetSettingsService',
  'setProviderRuntimeStateFactory',
  'settingsServiceInstance',
  'runtimeStateRegistry',
  'subscriptionRegistry',
  'subscribeToAgentRuntimeState',
] as const;

const BANNED_PATTERN = new RegExp(BANNED_AMBIENT_SYMBOLS.join('|'));

export interface AmbientSymbolViolation {
  file: string;
  line: number;
  text: string;
}

export interface AmbientSymbolScanResult {
  violations: AmbientSymbolViolation[];
  scannedFiles: number;
}

function isProductionSource(fileName: string): boolean {
  return (
    (fileName.endsWith('.ts') || fileName.endsWith('.tsx')) &&
    !/\.test\./.test(fileName) &&
    !/\.spec\./.test(fileName)
  );
}

function collectSourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist') {
          continue;
        }
        walk(fullPath);
      } else if (isProductionSource(entry)) {
        found.push(fullPath);
      }
    }
  };
  walk(root);
  return found;
}

function collectFileViolations(
  file: string,
  lines: string[],
  violations: AmbientSymbolViolation[],
): void {
  for (let index = 0; index < lines.length; index += 1) {
    if (BANNED_PATTERN.test(lines[index])) {
      violations.push({
        file,
        line: index + 1,
        text: lines[index].trim(),
      });
    }
  }
}

/**
 * Scan the given directories (each expected to be a packages/<pkg>/src
 * root, or any directory treated as a source root) for the deleted
 * ambient symbols.
 */
export function scanForBannedAmbientSymbols(
  sourceRoots: string[],
): AmbientSymbolScanResult {
  const violations: AmbientSymbolViolation[] = [];
  let scannedFiles = 0;

  for (const root of sourceRoots) {
    for (const file of collectSourceFiles(root)) {
      scannedFiles += 1;
      const content = readFileSync(file, 'utf-8');
      collectFileViolations(file, content.split('\n'), violations);
    }
  }

  return { violations, scannedFiles };
}
