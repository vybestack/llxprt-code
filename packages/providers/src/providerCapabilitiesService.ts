/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider capability detection, comparison, and context creation.
 * Extracted from ProviderManager to keep the main file under the lint
 * line budget.
 */

import type { IProvider } from './IProvider.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  ProviderCapabilities,
  ProviderContext,
  ProviderComparison,
} from './types.js';

const PROVIDER_CAPABILITY_HINTS: Record<
  string,
  Partial<ProviderCapabilities>
> = {
  gemini: {
    hasModelSelection: true,
    hasApiKeyConfig: true,
    hasBaseUrlConfig: false,
  },
  openai: {
    hasModelSelection: true,
    hasApiKeyConfig: true,
    hasBaseUrlConfig: true,
  },
  'openai-responses': {
    hasModelSelection: false,
    hasApiKeyConfig: true,
    hasBaseUrlConfig: true,
  },
  anthropic: {
    hasModelSelection: true,
    hasApiKeyConfig: true,
    hasBaseUrlConfig: true,
  },
  openaivercel: {
    hasModelSelection: true,
    hasApiKeyConfig: true,
    hasBaseUrlConfig: true,
  },
};

function readDefaultModel(provider: IProvider): string {
  const providerWithDefaultModel = provider as {
    getDefaultModel?: () => string | undefined;
  };
  return providerWithDefaultModel.getDefaultModel?.() ?? '';
}

export class ProviderCapabilitiesService {
  constructor(
    private readonly capabilities: Map<string, ProviderCapabilities>,
  ) {}

  captureProviderCapabilities(
    provider: IProvider,
    settingsService: SettingsService,
    config?: Config,
  ): ProviderCapabilities {
    const hints = PROVIDER_CAPABILITY_HINTS[provider.name] ?? {};

    return {
      supportsStreaming: true, // All current providers support streaming
      supportsTools: provider.getServerTools().length > 0,
      supportsVision: this.detectVisionSupport(
        provider,
        settingsService,
        config,
      ),
      maxTokens: this.getProviderMaxTokens(provider, settingsService, config),
      supportedFormats: this.getSupportedToolFormats(provider),
      hasModelSelection: hints.hasModelSelection ?? true,
      hasApiKeyConfig: hints.hasApiKeyConfig ?? true,
      hasBaseUrlConfig: hints.hasBaseUrlConfig ?? true,
      supportsPaidMode: typeof provider.isPaidMode === 'function',
    };
  }

  isContextPreserved(fromProvider: string, toProvider: string): boolean {
    const fromCapabilities = this.capabilities.get(fromProvider);
    const toCapabilities = this.capabilities.get(toProvider);

    if (!fromCapabilities || !toCapabilities) {
      return false;
    }

    const capabilityScore = this.calculateCapabilityCompatibility(
      fromCapabilities,
      toCapabilities,
    );
    return capabilityScore > 0.7;
  }

  compareProviders(provider1: string, provider2: string): ProviderComparison {
    const cap1 = this.capabilities.get(provider1);
    const cap2 = this.capabilities.get(provider2);

    if (!cap1 || !cap2) {
      throw new Error('Cannot compare providers: capabilities not available');
    }

    return {
      provider1,
      provider2,
      capabilities: {
        [provider1]: cap1,
        [provider2]: cap2,
      },
      compatibility: this.calculateCapabilityCompatibility(cap1, cap2),
      recommendation: this.generateProviderRecommendation(
        provider1,
        provider2,
        cap1,
        cap2,
      ),
    };
  }

  createProviderContext(
    provider: IProvider,
    capabilities: ProviderCapabilities,
    settingsService: SettingsService,
    config?: Config,
  ): ProviderContext {
    const providerSettings = settingsService.getProviderSettings(provider.name);
    const toolFormatSetting =
      (providerSettings.toolFormat as string | undefined) ?? 'auto';
    return {
      providerName: provider.name,
      currentModel:
        this.getStoredModelName(provider, settingsService, config) || 'unknown',
      toolFormat: toolFormatSetting,
      isPaidMode: provider.isPaidMode?.() ?? false,
      capabilities,
      sessionStartTime: Date.now(),
    };
  }

  getStoredModelName(
    provider: IProvider,
    settingsService: SettingsService,
    config?: Config,
  ): string {
    const providerSettings = settingsService.getProviderSettings(provider.name);
    const storedModel = providerSettings.model as string | undefined;
    if (storedModel && typeof storedModel === 'string' && storedModel.trim()) {
      return storedModel;
    }

    if (
      config &&
      typeof config.getProvider === 'function' &&
      config.getProvider() === provider.name
    ) {
      const configModel = config.getModel();
      if (configModel) {
        return configModel;
      }
    }

    return readDefaultModel(provider);
  }

  private detectVisionSupport(
    provider: IProvider,
    settingsService: SettingsService,
    config?: Config,
  ): boolean {
    const model = this.getStoredModelName(
      provider,
      settingsService,
      config,
    ).toLowerCase();
    switch (provider.name) {
      case 'gemini': {
        return true;
      }
      case 'openai': {
        return model.includes('vision') || model.includes('gpt-4');
      }
      case 'anthropic': {
        return model.includes('claude-3');
      }
      default:
        return false;
    }
  }

  private getProviderMaxTokens(
    provider: IProvider,
    settingsService: SettingsService,
    config?: Config,
  ): number {
    const model = this.getStoredModelName(
      provider,
      settingsService,
      config,
    ).toLowerCase();

    switch (provider.name) {
      case 'gemini':
        if (model.includes('pro')) return 32768;
        if (model.includes('flash')) return 8192;
        return 8192;
      case 'openai':
        if (model.includes('gpt-4')) return 8192;
        if (model.includes('gpt-3.5')) return 4096;
        return 4096;
      case 'anthropic':
        if (model.includes('claude-3')) return 200000;
        return 100000;
      default:
        return 4096;
    }
  }

  private getSupportedToolFormats(provider: IProvider): string[] {
    switch (provider.name) {
      case 'gemini':
        return ['function_calling', 'gemini_tools'];
      case 'openai':
        return ['function_calling', 'json_schema', 'hermes'];
      case 'anthropic':
        return ['xml_tools', 'anthropic_tools'];
      default:
        return [];
    }
  }

  private calculateCapabilityCompatibility(
    from: ProviderCapabilities,
    to: ProviderCapabilities,
  ): number {
    let score = 0;
    let totalChecks = 0;

    totalChecks++;
    if (from.supportsTools === to.supportsTools) score++;

    totalChecks++;
    if (from.supportsVision === to.supportsVision) score++;

    totalChecks++;
    if (from.supportsStreaming === to.supportsStreaming) score++;

    totalChecks++;
    const hasCommonFormats = from.supportedFormats.some((format) =>
      to.supportedFormats.includes(format),
    );
    if (hasCommonFormats) score++;

    return score / totalChecks;
  }

  private generateProviderRecommendation(
    provider1: string,
    provider2: string,
    cap1: ProviderCapabilities,
    cap2: ProviderCapabilities,
  ): string {
    if (cap1.maxTokens > cap2.maxTokens) {
      return `${provider1} supports longer contexts (${cap1.maxTokens} vs ${cap2.maxTokens} tokens)`;
    }

    if (cap1.supportsVision && !cap2.supportsVision) {
      return `${provider1} supports vision capabilities`;
    }

    if (cap1.supportedFormats.length > cap2.supportedFormats.length) {
      return `${provider1} supports more tool formats`;
    }

    return 'Providers have similar capabilities';
  }
}
