/**
 * Shared test helpers for canonical profile repair behavioral tests.
 *
 * Extracted so each test file stays under the eslint max-lines limit without
 * duplicating fixture builders or environment setup/teardown.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CORRUPT_PROVIDER } from '../canonicalProfileRepair.js';

export async function makeTempDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'llxprt-canonical-repair-test-'));
}

/**
 * The canonical corrupt signature: untyped standard-v1 profile whose
 * provider is the virtual non-loadable provider 'load-balancer', with
 * empty modelParams and empty ephemeralSettings.
 */
export function corruptCanonicalProfile(): Record<string, unknown> {
  return {
    version: 1,
    provider: CORRUPT_PROVIDER,
    model: 'gemini-2.5-pro',
    modelParams: {},
    ephemeralSettings: {},
  };
}

/**
 * A corrupt signature with a non-Gemini fallback model.
 */
export function corruptCanonicalProfileNonGeminiModel(): Record<
  string,
  unknown
> {
  return {
    version: 1,
    provider: CORRUPT_PROVIDER,
    model: 'some-other-fallback',
    modelParams: {},
    ephemeralSettings: {},
  };
}

/**
 * A corrupt canonical profile that omits modelParams entirely.
 */
export function corruptCanonicalProfileOmittedModelParams(): Record<
  string,
  unknown
> {
  return {
    version: 1,
    provider: CORRUPT_PROVIDER,
    model: 'gemini-2.5-pro',
    ephemeralSettings: {},
  };
}

/**
 * A valid legacy replacement profile with arbitrary provider/model/
 * endpoint/auth settings.
 */
export function validLegacyProfile(): Record<string, unknown> {
  return {
    version: 1,
    provider: 'anthropic',
    model: 'glm-5.2',
    modelParams: { temperature: 1 },
    ephemeralSettings: {
      'base-url': 'https://api.z.ai/api/anthropic',
      'auth-key-name': 'zai',
      'context-limit': 200000,
    },
  };
}

/**
 * A valid legacy replacement with a completely different provider/model/
 * endpoint/auth.
 */
export function validLegacyProfileAlternative(): Record<string, unknown> {
  return {
    version: 1,
    provider: 'openai',
    model: 'gpt-4o',
    modelParams: { temperature: 0.7, max_tokens: 4096 },
    ephemeralSettings: {
      'base-url': 'https://api.openai.com/v1',
      'auth-key': 'sk-test-key',
      'context-limit': 128000,
    },
  };
}

/**
 * A genuine load-balancer profile with valid type, policy, and profiles
 * settings. Such a profile is NOT corrupt — the type field disqualifies it
 * from the canonical corrupt signature.
 */
export function genuineLbProfile(): Record<string, unknown> {
  return {
    version: 1,
    type: 'loadbalancer',
    policy: 'roundrobin',
    profiles: ['p1'],
    provider: 'load-balancer',
    model: 'default',
    modelParams: {},
    ephemeralSettings: {},
  };
}

/**
 * A standard profile whose provider is the virtual non-loadable provider
 * 'load-balancer' but has nonempty modelParams — it does NOT match the
 * narrow canonical corrupt signature, yet it can never be loaded.
 */
export function lbProviderStandardWithSettings(): Record<string, unknown> {
  return {
    version: 1,
    provider: CORRUPT_PROVIDER,
    model: 'some-model',
    modelParams: { temperature: 0.5 },
    ephemeralSettings: {
      'base-url': 'https://example.com',
      'auth-key-name': 'test',
      'context-limit': 100000,
    },
  };
}

export interface TestEnv {
  canonicalDir: string;
  legacyDir: string;
  legacyProfilesDir: string;
}

export async function setupEnv(): Promise<TestEnv> {
  const canonicalDir = await makeTempDir();
  const legacyDir = await makeTempDir();
  const legacyProfilesDir = path.join(legacyDir, 'profiles');
  fs.mkdirSync(legacyProfilesDir, { recursive: true });
  return { canonicalDir, legacyDir, legacyProfilesDir };
}

export async function teardownEnv(env: TestEnv): Promise<void> {
  await fsp.rm(env.canonicalDir, { recursive: true, force: true });
  await fsp.rm(env.legacyDir, { recursive: true, force: true });
}

export function writeProfile(
  dir: string,
  name: string,
  data: Record<string, unknown>,
): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
}
