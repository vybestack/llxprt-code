#!/usr/bin/env node
/**
 * CI Quota Check Script
 *
 * Checks API quota for both keys and selects the one with lower usage.
 * Writes the selected key to GITHUB_ENV for downstream steps.
 *
 * Environment Variables:
 *   KEY_VAR_NAME - The name of the primary key variable (checked for "SYNTHETIC")
 *   OPENAI_API_KEY - Primary API key to check
 *   OPENAI_API_KEY_2 - Secondary API key to check
 *   GITHUB_ENV - Path to GitHub Actions environment file
 *
 * Exit codes:
 *   0 - Success (quota check completed, key selected or skipped)
 *   1 - Error (both keys >90% used, no keys configured, or other error)
 */

import fs from 'node:fs';

async function checkQuota(apiKey, keyName) {
  if (!apiKey) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch('https://api.synthetic.new/v2/quotas', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.log(
        `${keyName} quota check failed with status ${response.status}`,
      );
      return null;
    }

    const data = await response.json();

    if (
      !data.subscription ||
      typeof data.subscription.limit !== 'number' ||
      typeof data.subscription.requests !== 'number'
    ) {
      console.log(`${keyName} quota response missing required fields`);
      return null;
    }

    if (data.subscription.limit <= 0) {
      console.log(`${keyName} quota response has non-positive limit`);
      return null;
    }

    const usagePercent =
      (data.subscription.requests / data.subscription.limit) * 100;
    console.log(
      `${keyName}: ${usagePercent.toFixed(1)}% used (${data.subscription.requests}/${data.subscription.limit})`,
    );

    return { usagePercent, key: apiKey };
  } catch (e) {
    console.log(`${keyName} quota check error: ${e.message}`);
    return null;
  }
}

async function selectOptimalKey() {
  const key1 = process.env.OPENAI_API_KEY;
  const key2 = process.env.OPENAI_API_KEY_2;

  if (!key1 && !key2) {
    console.error('No API keys configured');
    process.exit(1);
  }

  const quota1 = await checkQuota(key1, 'Key 1');
  const quota2 = await checkQuota(key2, 'Key 2');

  // If both keys are >90% used, fail
  if (
    quota1 &&
    quota1.usagePercent > 90 &&
    quota2 &&
    quota2.usagePercent > 90
  ) {
    console.error('Both API keys are over 90% quota usage');
    process.exit(1);
  }

  let selectedKey = key1;
  let reason = 'using primary key (default)';

  if (!quota1 && !quota2) {
    reason = 'quota checks failed, using primary key';
  } else if (!quota1) {
    selectedKey = key2;
    reason = 'key1 check failed, using key2';
  } else if (!quota2 || !key2) {
    reason = 'key2 not available, using key1';
  } else if (quota2.usagePercent < quota1.usagePercent) {
    selectedKey = key2;
    reason = `key2 has lower usage (${quota2.usagePercent.toFixed(1)}% vs ${quota1.usagePercent.toFixed(1)}%)`;
  } else {
    reason = `key1 has lower or equal usage (${quota1.usagePercent.toFixed(1)}% vs ${quota2.usagePercent.toFixed(1)}%)`;
  }

  console.log(`Selected: ${reason}`);

  if (!selectedKey || selectedKey.trim() === '') {
    console.error('Selected API key is empty after quota selection');
    process.exit(1);
  }

  // Export to GITHUB_ENV
  const githubEnvPath = process.env.GITHUB_ENV;
  if (!githubEnvPath) {
    console.error('GITHUB_ENV environment variable not set');
    process.exit(1);
  }

  fs.appendFileSync(githubEnvPath, `OPENAI_API_KEY=${selectedKey}\n`);
}

async function main() {
  const keyVarName = process.env.KEY_VAR_NAME || '';
  const githubEnvPath = process.env.GITHUB_ENV;

  if (!githubEnvPath) {
    console.error('GITHUB_ENV environment variable not set');
    process.exit(1);
  }

  if (keyVarName.includes('SYNTHETIC')) {
    console.log('Using Synthetic provider, checking quota...');
    await selectOptimalKey();
  } else {
    console.log('Not using Synthetic provider, using primary key');
    // For non-Synthetic providers, just write the primary key to GITHUB_ENV
    const primaryKey = process.env.OPENAI_API_KEY;
    if (!primaryKey || primaryKey.trim() === '') {
      console.error('No primary API key configured');
      process.exit(1);
    }
    fs.appendFileSync(
      githubEnvPath,
      `OPENAI_API_KEY=${primaryKey}
`,
    );
  }
}

main().catch((e) => {
  console.error('Quota selection failed:', e.message);
  process.exit(1);
});
