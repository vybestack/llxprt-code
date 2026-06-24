/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P27
 * @requirement:REQ-021
 *
 * Test-only fixtures for the app-service behavioral round-trips. This helper
 * lives under `__tests__/helpers/` and is intentionally EXCLUDED from the
 * consumer-facing deep-import boundary scan (T17): it constructs the REAL
 * backing services (SettingsService, SkillManager, Storage, ProfileManager)
 * using their canonical source modules so the consumer-facing spec
 * (`app-service.spec.ts`) can stay on the public allowlist while still
 * exercising genuine persistence — no mock theater.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import { SkillManager } from '@vybestack/llxprt-code-core/skills/skillManager.js';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/config.js';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core/config/config.js';
import type { Profile } from '@vybestack/llxprt-code-settings';

export type { MCPServerConfig, GeminiCLIExtension, Profile };

export function createSettingsService(): SettingsService {
  return new SettingsService();
}

export function makeMcpServerConfig(): MCPServerConfig {
  return {
    command: 'node',
    args: ['server.js'],
  } as unknown as MCPServerConfig;
}

export function makeProfile(model: string): Profile {
  return {
    version: 1,
    provider: 'openai',
    model,
    modelParams: {},
    ephemeralSettings: {},
  };
}

export function makeExtensions(): GeminiCLIExtension[] {
  return [
    {
      name: 'ext-a',
      version: '1.0.0',
      isActive: true,
      path: '/tmp/ext-a',
      contextFiles: [],
    },
    {
      name: 'ext-b',
      version: '2.0.0',
      isActive: true,
      path: '/tmp/ext-b',
      contextFiles: [],
    },
  ];
}

export async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * Seed a real project-local skill and discover it through the real
 * SkillManager, returning a manager populated with genuine skill data.
 */
export async function createSkillManagerWithSeededSkill(
  projectRoot: string,
  skillName: string,
): Promise<SkillManager> {
  const skillDir = path.join(projectRoot, '.llxprt', 'skills', skillName);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: A real test skill\n---\nBody content.\n`,
    'utf-8',
  );

  const storage = new Storage(projectRoot);
  const manager = new SkillManager();
  await manager.discoverSkills(storage);
  return manager;
}
