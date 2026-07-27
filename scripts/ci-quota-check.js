#!/usr/bin/env node
/**
 * CI Quota Check Script
 *
 * Checks API quota for both keys and selects the one with lower usage.
 * Writes only the selected key identifier to GITHUB_OUTPUT for downstream steps.
 *
 * Environment Variables:
 *   KEY_VAR_NAME - The name of the primary key variable (checked for "SYNTHETIC")
 *   OPENAI_API_KEY - Primary API key to check
 *   OPENAI_API_KEY_2 - Secondary API key to check
 *   GITHUB_OUTPUT - Path to GitHub Actions output file
 *
 * Exit codes:
 *   0 - Success (quota check completed, key selected or skipped)
 *   1 - Error (both keys >90% used, no keys configured, or other error)
 */

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Returns true when the value contains CR or LF characters. Such characters
 * are not valid in API keys and must never reach external requests.
 */
function containsNewline(value) {
  return value.includes('\r') || value.includes('\n');
}

/**
 * Rejects a key that contains CR/LF characters before any GITHUB_ENV or
 * GITHUB_OUTPUT write. Throws to abort the process so no tainted write
 * occurs. Called in both Synthetic and non-Synthetic paths.
 */
function assertKeySafe(key, label) {
  if (containsNewline(key)) {
    throw new Error(
      `${label} contains CR/LF characters and is not a valid API key.`,
    );
  }
}

function writeSelectedKeyOutput(selectedKeyName) {
  const githubOutputPath = process.env.GITHUB_OUTPUT;
  if (githubOutputPath) {
    fs.appendFileSync(githubOutputPath, `selected_key=${selectedKeyName}\n`);
  }
}

/**
 * Propagates the selected key to GITHUB_ENV so the downstream "Run planner
 * agent" step can read it as $OPENAI_API_KEY. Step-scoped env does NOT
 * propagate across steps; without this write the agent step sees an empty
 * key and fails authentication. The "Clear selected API key" step unsets
 * this value in finally.
 */
function exportSelectedKeyToEnv(keyValue, keyName) {
  const githubEnvPath = process.env.GITHUB_ENV;
  if (!githubEnvPath) {
    return;
  }
  assertKeySafe(keyValue, keyName);
  // GITHUB_ENV delimiter protocol: a heredoc-style block avoids shell
  // injection from key values containing quotes or special characters.
  // A random suffix guarantees the delimiter cannot collide with the key
  // value itself, which would prematurely terminate the heredoc.
  const delimiter = `ghadelimiter_${keyName}_${randomUUID()}`;
  if (keyValue.includes(delimiter)) {
    throw new Error(
      `${keyName} contains the generated delimiter and cannot be safely written to GITHUB_ENV.`,
    );
  }
  fs.appendFileSync(
    githubEnvPath,
    `OPENAI_API_KEY<<${delimiter}\n${keyValue}\n${delimiter}\n`,
  );
}

async function checkQuota(apiKey, keyName) {
  if (!apiKey) return null;

  assertKeySafe(apiKey, keyName);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch('https://api.synthetic.new/v2/quotas', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      console.log(
        `${keyName} quota check failed with status ${response.status}`,
      );
      return null;
    }

    const data = await response.json();
    const limit = data.subscription?.limit;
    const requests = data.subscription?.requests;
    if (
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      !Number.isSafeInteger(requests) ||
      requests < 0
    ) {
      console.log(`${keyName} quota response has invalid counters`);
      return null;
    }

    const usagePercent = (requests / limit) * 100;
    console.log(
      `${keyName}: ${usagePercent.toFixed(1)}% used (${requests}/${limit})`,
    );

    return { usagePercent, key: apiKey };
  } catch (e) {
    console.log(`${keyName} quota check error: ${e.message}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function selectOptimalKey() {
  const key1 = process.env.OPENAI_API_KEY;
  const key2 = process.env.OPENAI_API_KEY_2;

  if (!key1 && !key2) {
    console.error('No API keys configured');
    process.exit(1);
  }

  const quota1 = await checkQuota(key1, 'Key 1');
  const quota2 = await checkQuota(key2, 'Key 2');

  const usable1 = quota1?.usagePercent <= 90 ? quota1 : null;
  const usable2 = quota2?.usagePercent <= 90 ? quota2 : null;

  if (!usable1 && !usable2 && (quota1 || quota2)) {
    throw new Error('No verified API key is at or below 90% quota usage');
  }

  let selectedKey;
  let reason;

  if (!quota1 && !quota2) {
    selectedKey = key1 || key2;
    reason = 'quota checks failed, using first configured key';
  } else if (!usable1) {
    selectedKey = key2;
    reason = 'key1 unavailable or over quota, using key2';
  } else if (!usable2) {
    selectedKey = key1;
    reason = 'key2 unavailable or over quota, using key1';
  } else if (usable2.usagePercent < usable1.usagePercent) {
    selectedKey = key2;
    reason = `key2 has lower usage (${usable2.usagePercent.toFixed(1)}% vs ${usable1.usagePercent.toFixed(1)}%)`;
  } else {
    selectedKey = key1;
    reason = `key1 has lower or equal usage (${usable1.usagePercent.toFixed(1)}% vs ${usable2.usagePercent.toFixed(1)}%)`;
  }

  console.log(`Selected: ${reason}`);

  if (!selectedKey || selectedKey.trim() === '') {
    console.error('Selected API key is empty after quota selection');
    process.exit(1);
  }

  assertKeySafe(selectedKey, 'Selected API key');

  const selectedKeyName = selectedKey === key2 ? 'secondary' : 'primary';
  writeSelectedKeyOutput(selectedKeyName);
  exportSelectedKeyToEnv(selectedKey, selectedKeyName);
}

export async function main() {
  const keyVarName = process.env.KEY_VAR_NAME || '';

  if (keyVarName.includes('SYNTHETIC')) {
    console.log('Using Synthetic provider, checking quota...');
    await selectOptimalKey();
  } else {
    console.log('Not using Synthetic provider, using primary key');
    // For non-Synthetic providers, use the first configured key
    const primaryKey =
      process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_2;
    if (!primaryKey || primaryKey.trim() === '') {
      console.error('No API key configured');
      process.exit(1);
    }
    assertKeySafe(primaryKey, 'Primary API key');
    const selectedKeyName =
      primaryKey === process.env.OPENAI_API_KEY_2 ? 'secondary' : 'primary';
    writeSelectedKeyOutput(selectedKeyName);
    exportSelectedKeyToEnv(primaryKey, selectedKeyName);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((e) => {
    console.error('Quota selection failed:', e.message);
    process.exit(1);
  });
}
