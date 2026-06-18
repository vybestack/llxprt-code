/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { createHash } from 'node:crypto';
import { DebugLogger } from '../../debug/DebugLogger.js';

const logger = new DebugLogger('llxprt:prompt-config:installer');

export const MANIFEST_FILE = '.installed-manifest.json';
export const MANIFEST_VERSION = 1;

const InstalledFileEntrySchema = z.object({
  hash: z.string(),
  installedAt: z.string(),
});

const InstalledManifestSchema = z.object({
  version: z.number(),
  files: z.record(z.string(), InstalledFileEntrySchema),
});

export type InstalledManifest = z.infer<typeof InstalledManifestSchema>;

/** Compute SHA-256 hash of content, hex-encoded. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/** Load installed manifest from disk with Zod validation. */
export async function loadManifest(
  baseDir: string,
): Promise<InstalledManifest | null> {
  const manifestPath = path.join(baseDir, MANIFEST_FILE);
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(content);
    const result = InstalledManifestSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    logger.debug('Invalid manifest format:', result.error.message);
    return null;
  } catch {
    return null;
  }
}

/** Save manifest to disk. */
export async function saveManifest(
  baseDir: string,
  manifest: InstalledManifest,
): Promise<void> {
  const manifestPath = path.join(baseDir, MANIFEST_FILE);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
    mode: 0o644,
  });
}

/** Load an existing manifest or create a fresh empty one (no-op during dry runs). */
export async function loadOrCreateManifest(
  expandedBaseDir: string,
  dryRun: boolean,
): Promise<InstalledManifest | null> {
  let manifest: InstalledManifest | null = null;
  if (!dryRun && existsSync(expandedBaseDir)) {
    manifest = await loadManifest(expandedBaseDir);
  }
  if (!manifest && !dryRun) {
    manifest = { version: MANIFEST_VERSION, files: {} };
  }
  return manifest;
}

/** Get installed hash for a file from manifest. */
export function getInstalledHash(
  manifest: InstalledManifest | null,
  relativePath: string,
): string | null {
  if (!manifest?.files[relativePath]) {
    return null;
  }
  return manifest.files[relativePath].hash;
}

/** Update manifest entry for a file. */
export function updateManifestEntry(
  manifest: InstalledManifest,
  relativePath: string,
  hash: string,
): void {
  manifest.files[relativePath] = {
    hash,
    installedAt: new Date().toISOString(),
  };
}
