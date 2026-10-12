import { useRuntimeTestOwners as installRuntimeTestOwners } from '../runtime/__tests__/runtime-owner-test-helpers.js';
const fixtureOwners = installRuntimeTestOwners();
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression test: wrappers (RetryOrchestrator, LoggingProviderWrapper)
 * must tolerate providers that do not implement getDefaultModel.
 *
 * Root cause: IProvider declares getDefaultModel() as required, but the
 * runtime contract (RuntimeProvider) declares it optional. Minimal mocks
 * and DI-constructed providers may omit it. The wrappers must use the
 * safeGetDefaultModel utility instead of calling getDefaultModel directly.
 */

import { captureProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { describe, it, expect } from 'bun:test';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import { safeGetDefaultModel } from '../utils/safeDefaultModel.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

/**
 * Minimal provider that satisfies the structural shape for generateChatCompletion
 * but intentionally lacks getDefaultModel. This mirrors the test mocks that
 * caused the original crash.
 */
function createProviderWithoutDefaultModel(name: string): IProvider {
  return {
    name,
    async *generateChatCompletion(
      _options: GenerateChatOptions,
    ): AsyncIterableIterator<IContent> {
      yield { role: 'assistant', parts: [{ text: 'ok' }] } as IContent;
    },
    async getModels() {
      return [];
    },
    // getDefaultModel intentionally omitted
  } as unknown as IProvider;
}

describe('safeGetDefaultModel regression', () => {
  describe('safeGetDefaultModel utility', () => {
    it('returns the model when getDefaultModel is present', () => {
      const provider = {
        getDefaultModel: () => 'gpt-4',
      };
      expect(safeGetDefaultModel(provider)).toBe('gpt-4');
    });

    it('returns empty string when getDefaultModel is absent', () => {
      const provider = {};
      expect(safeGetDefaultModel(provider)).toBe('');
    });

    it('returns empty string when getDefaultModel is undefined', () => {
      const provider = { getDefaultModel: undefined };
      expect(safeGetDefaultModel(provider)).toBe('');
    });

    it('returns empty string when getDefaultModel is non-callable', () => {
      const provider = { getDefaultModel: 'gpt-4' };
      expect(safeGetDefaultModel(provider)).toBe('');
    });

    it('returns empty string when getDefaultModel returns undefined', () => {
      const provider = { getDefaultModel: () => undefined };
      expect(safeGetDefaultModel(provider)).toBe('');
    });

    it('returns empty string when getDefaultModel returns null', () => {
      const provider = { getDefaultModel: () => null };
      expect(safeGetDefaultModel(provider)).toBe('');
    });
  });

  describe('safeGetDefaultModel error tolerance', () => {
    it('returns empty string when getDefaultModel throws', () => {
      const provider = {
        getDefaultModel: () => {
          throw new Error('boom');
        },
      };
      expect(() => safeGetDefaultModel(provider)).not.toThrow();
      expect(safeGetDefaultModel(provider)).toBe('');
    });
  });

  describe('RetryOrchestrator with provider lacking getDefaultModel', () => {
    it('does not crash when calling getDefaultModel on the wrapper', () => {
      const raw = createProviderWithoutDefaultModel('test-provider');
      const orchestrator = new RetryOrchestrator(raw);
      expect(orchestrator.getDefaultModel()).toBe('');
    });

    it('streams content without crashing', async () => {
      const raw = createProviderWithoutDefaultModel('test-provider');
      const orchestrator = new RetryOrchestrator(raw);
      const settingsService = new SettingsService();
      const config = createRuntimeConfigStub(settingsService);
      const options: GenerateChatOptions = {
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        config,
      };
      const chunks: IContent[] = [];
      for await (const chunk of orchestrator.generateChatCompletion(options)) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(1);
    });
  });

  describe('LoggingProviderWrapper with provider lacking getDefaultModel', () => {
    it('does not crash when calling getDefaultModel on the wrapper', () => {
      const raw = createProviderWithoutDefaultModel('test-provider');
      const settingsService = new SettingsService();
      const config = createRuntimeConfigStub(settingsService);
      const wrapperSettings1 = fixtureOwners.adopt(
        config,
        new SettingsService(),
      ).settingsOwner;
      const wrapper = new LoggingProviderWrapper(raw, config, undefined, () =>
        captureProviderRequestDiagnostics(config, wrapperSettings1),
      );
      expect(wrapper.getDefaultModel()).toBe('');
    });

    it('streams content without crashing', async () => {
      const raw = createProviderWithoutDefaultModel('test-provider');
      const settingsService = new SettingsService();
      const config = createRuntimeConfigStub(settingsService);
      const wrapperSettings2 = fixtureOwners.adopt(
        config,
        new SettingsService(),
      ).settingsOwner;
      const wrapper = new LoggingProviderWrapper(raw, config, undefined, () =>
        captureProviderRequestDiagnostics(config, wrapperSettings2),
      );
      const options: GenerateChatOptions = {
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        config,
        invocation: captureProviderInvocation(
          { settingsService, runtimeId: 'test-runtime' },
          'test',
        ),
        runtime: {
          diagnostics: captureProviderRequestDiagnostics(config),
          runtimeId: 'test-runtime',
          metadata: {},
        },
      };
      const chunks: IContent[] = [];
      for await (const chunk of wrapper.generateChatCompletion(options)) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(1);
    });
  });

  describe('Full wrapper chain (RetryOrchestrator + LoggingProviderWrapper)', () => {
    it('streams through both wrappers without crashing', async () => {
      const raw = createProviderWithoutDefaultModel('test-provider');
      const settingsService = new SettingsService();
      const config = createRuntimeConfigStub(settingsService);
      const orchestrator = new RetryOrchestrator(raw);
      const wrapperSettings3 = fixtureOwners.adopt(
        config,
        new SettingsService(),
      ).settingsOwner;
      const wrapper = new LoggingProviderWrapper(
        orchestrator,
        config,
        undefined,
        () => captureProviderRequestDiagnostics(config, wrapperSettings3),
      );

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        config,
        invocation: captureProviderInvocation(
          { settingsService, runtimeId: 'test-runtime' },
          'test',
        ),
        runtime: {
          diagnostics: captureProviderRequestDiagnostics(config),
          runtimeId: 'test-runtime',
          metadata: {},
        },
      };
      const chunks: IContent[] = [];
      for await (const chunk of wrapper.generateChatCompletion(options)) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(1);
    });
  });
});
