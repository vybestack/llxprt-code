/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #3953: settings cleared by a provider switch
 * (written as `undefined`, which keeps the property enumerable on the stored
 * settings object) must not count as surviving overrides. Only keys that still
 * hold a defined value after the clear block the target provider's model
 * defaults.
 *
 * The switch runs through the production `switchActiveProvider` entry point so
 * the real clear/default ordering is exercised; nothing here is stubbed except
 * the providers themselves, which never issue a request.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  ProviderManager,
  type IProvider,
} from '@vybestack/llxprt-code-providers';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-core';

const TARGET_PROVIDER = 'reasoning-fixture';
const TARGET_MODEL = 'fixture-model-1';

class FixtureProvider implements IProvider {
  constructor(
    readonly name: string,
    private readonly defaultModel: string,
  ) {}

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  async *generateChatCompletion(): AsyncIterableIterator<never> {
    // never driven: switching providers does not issue requests
  }
}

function writeTargetAlias(dataHome: string): void {
  const aliasDir = path.join(dataHome, 'providers');
  fs.mkdirSync(aliasDir, { recursive: true });
  fs.writeFileSync(
    path.join(aliasDir, `${TARGET_PROVIDER}.config`),
    JSON.stringify({
      baseProvider: 'openai',
      'base-url': 'https://reasoning-fixture.test/v1',
      defaultModel: TARGET_MODEL,
      modelDefaults: [
        {
          pattern: 'fixture-model',
          ephemeralSettings: {
            'reasoning.enabled': true,
            'reasoning.effort': 'high',
            'reasoning.effortWireFormat': 'openai',
          },
        },
      ],
    }),
  );
}

interface SwitchHarness {
  readonly owner: SessionSettingsOwner;
  readonly switchTo: ProviderSwitcher;
  readonly dispose: () => Promise<void>;
}

async function createSwitchHarness(): Promise<SwitchHarness> {
  const config = new Config({
    sessionId: 'reasoning-keys-fixture',
    model: '',
    provider: 'openai',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
  });
  const settingsService = new SettingsService();
  const owner = new SessionSettingsOwner(settingsService);
  owner.bindTelemetry(config);
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settingsService.set(key, value);
  owner.initializeProviderSelection(config.getProvider(), config.getModel());

  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    settingsService,
    config,
    undefined,
    undefined,
    owner,
  );
  manager.registerProvider(new FixtureProvider('openai', 'gpt-4o'));
  manager.registerProvider(new FixtureProvider(TARGET_PROVIDER, TARGET_MODEL));
  manager.setActiveProvider('openai');

  const { switchActiveProvider } = await import('./provider-switch.js');
  const switchTo: ProviderSwitcher = (name, options = {}) =>
    switchActiveProvider(
      name,
      options,
      config,
      settingsService,
      manager,
      null,
      undefined,
      async () => {},
      owner,
    );
  return {
    owner,
    switchTo,
    dispose: async () => {
      manager.dispose();
      await owner.dispose();
      await config.dispose();
    },
  };
}

describe('provider switch reasoning defaults after clear (#3953)', () => {
  let dataHome: string;
  let previousDataHome: string | undefined;

  beforeEach(() => {
    dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'reasoning-keys-'));
    writeTargetAlias(dataHome);
    previousDataHome = process.env['LLXPRT_DATA_HOME'];
    process.env['LLXPRT_DATA_HOME'] = dataHome;
  });

  afterEach(() => {
    if (previousDataHome === undefined) delete process.env['LLXPRT_DATA_HOME'];
    else process.env['LLXPRT_DATA_HOME'] = previousDataHome;
    fs.rmSync(dataHome, { recursive: true, force: true });
  });

  it('applies model defaults for reasoning settings the previous profile had set', async () => {
    const { owner, switchTo, dispose } = await createSwitchHarness();
    try {
      owner.writeNamedParameter('reasoning.enabled', false);
      owner.writeNamedParameter('reasoning.effort', 'low');

      await switchTo(TARGET_PROVIDER, {});

      expect(owner.readNamedParameter('reasoning.enabled')).toBe(true);
      expect(owner.readNamedParameter('reasoning.effort')).toBe('high');
    } finally {
      await dispose();
    }
  });

  it('keeps a preserved reasoning value over the model default while other cleared keys receive defaults', async () => {
    const { owner, switchTo, dispose } = await createSwitchHarness();
    try {
      owner.writeNamedParameter('reasoning.enabled', false);
      owner.writeNamedParameter('reasoning.effort', 'low');

      await switchTo(TARGET_PROVIDER, {
        preserveEphemerals: ['reasoning.effort'],
      });

      expect(owner.readNamedParameter('reasoning.effort')).toBe('low');
      expect(owner.readNamedParameter('reasoning.enabled')).toBe(true);
    } finally {
      await dispose();
    }
  });

  it('keeps a user-owned reasoning selector over the model default', async () => {
    const { owner, switchTo, dispose } = await createSwitchHarness();
    try {
      owner.writeUserParameter('reasoning.effortWireFormat', 'anthropic');
      owner.writeNamedParameter('reasoning.effort', 'low');

      await switchTo(TARGET_PROVIDER, {});

      expect(owner.readNamedParameter('reasoning.effortWireFormat')).toBe(
        'anthropic',
      );
      expect(owner.readNamedParameter('reasoning.effort')).toBe('high');
    } finally {
      await dispose();
    }
  });

  it('treats a cleared nested child as absent while a preserved sibling survives', async () => {
    const { owner, switchTo, dispose } = await createSwitchHarness();
    try {
      owner.writeNamedParameter('reasoning.enabled', false);
      owner.writeNamedParameter('reasoning.effort', 'low');

      await switchTo(TARGET_PROVIDER, {
        preserveEphemerals: ['reasoning.enabled'],
      });

      expect(owner.readNamedParameter('reasoning.enabled')).toBe(false);
      expect(owner.readNamedParameter('reasoning.effort')).toBe('high');
    } finally {
      await dispose();
    }
  });
});
