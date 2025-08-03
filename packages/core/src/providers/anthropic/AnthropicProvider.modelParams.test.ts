import { describe, it, expect, beforeEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';

describe('AnthropicProvider - modelParams', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider(
      'test-api-key',
      undefined,
      TEST_PROVIDER_CONFIG,
    );
  });

  describe('setModelParams', () => {
    it('should set model parameters', () => {
      const params = { temperature: 0.7, top_p: 0.9 };
      provider.setModelParams(params);
      expect(provider.getModelParams()).toEqual(params);
    });

    it('should merge new parameters with existing ones', () => {
      provider.setModelParams({ temperature: 0.7 });
      provider.setModelParams({ top_p: 0.9 });
      expect(provider.getModelParams()).toEqual({
        temperature: 0.7,
        top_p: 0.9,
      });
    });

    it('should override existing parameters with same key', () => {
      provider.setModelParams({ temperature: 0.7, top_p: 0.9 });
      provider.setModelParams({ temperature: 0.5 });
      expect(provider.getModelParams()).toEqual({
        temperature: 0.5,
        top_p: 0.9,
      });
    });

    it('should clear all parameters when undefined is passed', () => {
      provider.setModelParams({ temperature: 0.7, top_p: 0.9 });
      provider.setModelParams(undefined);
      expect(provider.getModelParams()).toBeUndefined();
    });
  });

  describe('getModelParams', () => {
    it('should return undefined when no parameters are set', () => {
      expect(provider.getModelParams()).toBeUndefined();
    });

    it('should return the current model parameters', () => {
      const params = { temperature: 0.7, top_p: 0.9, stop_sequences: ['\\n'] };
      provider.setModelParams(params);
      expect(provider.getModelParams()).toEqual(params);
    });
  });
});
