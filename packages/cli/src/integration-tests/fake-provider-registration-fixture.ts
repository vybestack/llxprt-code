/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as nodeOs from 'node:os';
import {
  Config,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  NodeFileSystem,
  createProviderManager,
} from '@vybestack/llxprt-code-providers/composition.js';
import { CredentialAuthority } from '../../../providers/src/auth/proxy/credential-store-factory.js';

export function observeFakeProviderRegistration(): {
  readonly registeredProviderNames: readonly string[];
  readonly activeProviderName: string | undefined;
  readonly activeProviderImplementationName: string | undefined;
} {
  const tempDir = fs.mkdtempSync(path.join(nodeOs.tmpdir(), 'p13-fake-'));
  try {
    // Write a minimal JSONL fixture
    const fixturePath = path.join(tempDir, 'fake.jsonl');
    fs.writeFileSync(
      fixturePath,
      JSON.stringify({
        chunks: [{ speaker: 'ai', blocks: [{ type: 'text', text: 'test' }] }],
      }),
      'utf-8',
    );

    const originalEnv = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fixturePath;

    try {
      const settingsService = new SettingsService();
      const cfg = new Config({
        sessionId: 'p13-fake',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'fake-model',
      });
      const rt = createProviderRuntimeContext({
        config: cfg,
      });
      const { manager } = createProviderManager(
        settingsService,
        rt,
        cfg,
        new CredentialAuthority(),
        new NodeFileSystem(),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      );

      return {
        registeredProviderNames: manager.listProviders(),
        activeProviderName: manager.getActiveProviderName(),
        activeProviderImplementationName: manager.getActiveProvider()?.name,
      };
    } finally {
      if (originalEnv === undefined) {
        delete process.env.LLXPRT_FAKE_RESPONSES;
      } else {
        process.env.LLXPRT_FAKE_RESPONSES = originalEnv;
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
