import {
  Config,
  ProviderManager,
  OpenAIProvider,
  AnthropicProvider,
  SettingsService,
  registerSettingsService,
  resetSettingsService,
} from '@vybestack/llxprt-code-core';
import type {
  GeminiClient,
  ConfigParameters,
} from '@vybestack/llxprt-code-core';

export interface ConfigSessionOptions {
  readonly model: string;
  readonly workingDir: string;
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly authKeyfile?: string;
  readonly apiKey?: string;
  readonly debugMode?: boolean;
}

export interface ConfigSession {
  readonly config: Config;
  initialize(): Promise<void>;
  getClient(): GeminiClient;
  dispose(): void;
}

/**
 * Create the appropriate provider instance based on provider name.
 */
function createProvider(
  providerName: string,
  apiKey: string | undefined,
  baseUrl: string | undefined,
): OpenAIProvider | AnthropicProvider | null {
  const name = providerName.toLowerCase();

  if (name === 'openai' || name === 'openai-responses') {
    return new OpenAIProvider(apiKey, baseUrl);
  }
  if (name === 'anthropic') {
    return new AnthropicProvider(apiKey, baseUrl);
  }

  // Unknown provider - return null and fall back to Gemini
  return null;
}

/**
 * Check if a provider requires a ProviderManager (non-Gemini providers).
 */
function requiresProviderManager(providerName: string | undefined): boolean {
  if (!providerName) return false;
  const name = providerName.toLowerCase();
  return (
    name === 'openai' || name === 'openai-responses' || name === 'anthropic'
  );
}

export function createConfigSession(
  options: ConfigSessionOptions,
): ConfigSession {
  // Reset any existing context and create a fresh SettingsService
  resetSettingsService();
  const settings = new SettingsService();
  registerSettingsService(settings);

  // CRITICAL: Set model in SettingsService - providers read from here, not from Config
  settings.set('model', options.model);

  if (options.baseUrl) {
    settings.set('base-url', options.baseUrl);
  }
  if (options.authKeyfile) {
    settings.set('auth-keyfile', options.authKeyfile);
  }
  if (options.apiKey) {
    settings.set('auth-key', options.apiKey);
  }
  if (options.provider) {
    settings.set('activeProvider', options.provider);
  }

  const timestamp = Date.now();
  const configParams = {
    sessionId: `nui-${timestamp}`,
    targetDir: options.workingDir,
    cwd: options.workingDir,
    debugMode: options.debugMode ?? false,
    model: options.model,
    provider: options.provider,
    settingsService: settings,
    telemetry: { enabled: false },
    checkpointing: false,
    // Use default llxprt-code policy behavior:
    // - Read-only tools (read_file, glob, etc.) are auto-approved
    // - Write tools (edit, shell, write_file) require confirmation
    // The default TOML policies handle this via priority-based rules
    policyEngineConfig: {
      defaultDecision: 'ask_user' as const,
    },
  } as ConfigParameters;

  const config = new Config(configParams);

  let initialized = false;
  let client: GeminiClient | undefined;

  return {
    config,

    async initialize(): Promise<void> {
      if (initialized) {
        return;
      }
      await config.initialize();

      // For non-Gemini providers, set up ProviderManager first
      if (requiresProviderManager(options.provider)) {
        const provider = createProvider(
          options.provider ?? '',
          options.apiKey,
          options.baseUrl,
        );

        if (provider) {
          const providerManager = new ProviderManager();
          providerManager.setConfig(config);
          providerManager.registerProvider(provider);
          providerManager.setActiveProvider(provider.name);
          config.setProviderManager(providerManager);
        }
      }

      client = config.getGeminiClient();
      initialized = true;
    },

    getClient(): GeminiClient {
      if (!client) {
        throw new Error(
          'ConfigSession not initialized. Call initialize() first.',
        );
      }
      return client;
    },

    dispose(): void {
      initialized = false;
      client = undefined;
      resetSettingsService();
    },
  };
}
