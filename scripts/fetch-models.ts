#!/usr/bin/env npx tsx
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prebuild script to fetch models.dev API data and bundle as fallback
 *
 * Usage:
 *   npx tsx scripts/fetch-models.ts
 *   npm run fetch-models
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODELS_DEV_API_URL = 'https://models.dev/api.json';
const OUTPUT_PATH = path.join(
  __dirname,
  '../packages/core/src/assets/fallback-models.json',
);
const FETCH_TIMEOUT_MS = 30000; // 30 seconds for build

interface FetchResult {
  success: boolean;
  providerCount?: number;
  modelCount?: number;
  error?: string;
}

async function fetchModels(): Promise<FetchResult> {
  console.log('Fetching models from models.dev...');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(MODELS_DEV_API_URL, {
      headers: {
        'User-Agent': 'llxprt-build/1.0',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false,
        error: `API returned ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();

    // Count providers and models
    let providerCount = 0;
    let modelCount = 0;

    for (const providerId of Object.keys(data)) {
      providerCount++;
      const provider = data[providerId];
      if (provider.models) {
        modelCount += Object.keys(provider.models).length;
      }
    }

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write to file with pretty formatting
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));

    return {
      success: true,
      providerCount,
      modelCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
    };
  }
}

async function main(): Promise<void> {
  const result = await fetchModels();

  if (result.success) {
    console.log(
      `Bundled ${result.providerCount} providers and ${result.modelCount} models`,
    );
    console.log(`   Output: ${OUTPUT_PATH}`);
  } else {
    console.error(`❌ Failed to fetch models: ${result.error}`);

    // Check if fallback already exists
    if (fs.existsSync(OUTPUT_PATH)) {
      console.log('⚠️  Using existing fallback file');
      process.exit(0);
    } else {
      console.error('❌ No fallback file exists - build may fail');
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
