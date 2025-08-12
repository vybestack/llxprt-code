/**
 * Settings service implementation
 */

import { EventEmitter } from 'events';
import { z } from 'zod';
import { IProvider } from '../providers/IProvider.js';
import {
  ISettingsService,
  ISettingsRepository,
  GlobalSettings,
  SettingsChangeEvent,
  EventListener,
  EventUnsubscribe,
  ProviderSettings,
  UISettings,
  TelemetrySettings,
  AdvancedSettings,
  DiagnosticsInfo,
} from './types.js';

// Validation schemas
const ProviderSettingsSchema = z
  .object({
    enabled: z.boolean(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    maxTokens: z.number().optional(),
    temperature: z.number().min(0).max(2).optional(),
    toolFormat: z
      .enum([
        'auto',
        'openai',
        'qwen',
        'hermes',
        'xml',
        'anthropic',
        'deepseek',
        'gemma',
        'llama',
      ])
      .optional(),
  })
  .passthrough();

const QwenProviderSettingsSchema = z
  .object({
    enabled: z.boolean(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    maxTokens: z.number().optional(),
    temperature: z.number().min(0).max(2).optional(),
    toolFormat: z
      .enum([
        'auto',
        'openai',
        'qwen',
        'hermes',
        'xml',
        'anthropic',
        'deepseek',
        'gemma',
        'llama',
      ])
      .optional(),
  })
  .passthrough()
  .refine((data) => {
    // If this is a qwen provider and enabled, require that baseUrl and model are defined (not undefined)
    // They can be empty strings, but they must be present
    if (data.enabled) {
      return data.baseUrl !== undefined && data.model !== undefined;
    }
    return true;
  }, 'Qwen provider requires baseUrl and model fields when enabled');

const GlobalSettingsSchema = z
  .object({
    defaultProvider: z.string().optional(),
    providers: z.record(ProviderSettingsSchema),
    ui: z
      .object({
        theme: z.enum(['light', 'dark', 'auto']).optional(),
        fontSize: z.number().optional(),
        compactMode: z.boolean().optional(),
      })
      .optional()
      .nullable(),
    telemetry: z
      .object({
        enabled: z.boolean(),
        level: z.enum(['minimal', 'standard', 'detailed']).optional(),
      })
      .optional(),
    advanced: z
      .object({
        debug: z.boolean().optional(),
        logLevel: z.enum(['error', 'warn', 'info', 'debug']).optional(),
        maxRetries: z.number().optional(),
        timeout: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();

// Operation queue types
interface Operation {
  type: 'update' | 'switch';
  resolve: () => void;
  reject: (error: Error) => void;
}

interface UpdateOperation extends Operation {
  type: 'update';
  provider?: string;
  changes: Partial<GlobalSettings> | Partial<ProviderSettings>;
}

interface SwitchOperation extends Operation {
  type: 'switch';
  newProvider: string;
}

/**
 * Settings service that manages global application settings
 */
export class SettingsService extends EventEmitter implements ISettingsService {
  private settings!: GlobalSettings;
  private repository: ISettingsRepository;
  private validators: Map<string, z.ZodSchema> = new Map();
  private backupSettings: GlobalSettings | null = null;
  private isInitialized: boolean = false;
  private operationQueue: Operation[] = [];
  private isProcessingQueue: boolean = false;
  private currentProfileName: string | null = null;

  constructor(repository: ISettingsRepository) {
    super(); // Initialize EventEmitter
    this.repository = repository;
    this.validators = new Map();
    this.backupSettings = null;

    // Initialize with defaults first
    this.loadDefaultSettings();

    try {
      this.initializeValidators();
      // Setup file watcher
      this.setupFileWatcher();
      this.isInitialized = true;

      // Asynchronously load settings from repository without blocking constructor
      this.loadSettingsFromRepository()
        .then(() => {
          this.emit('initialized' as never);
        })
        .catch((error) => {
          console.error('Failed to initialize SettingsService:', error);
          this.emit('initialized' as never, { error: true });
        });
    } catch (error) {
      console.error('Failed to initialize SettingsService:', error);
      this.isInitialized = true;
      this.emit('initialized' as never, { error: true });
    }
  }

  private initializeValidators(): void {
    const providers = ['openai', 'gemini', 'anthropic', 'glm'];
    for (const provider of providers) {
      this.validators.set(provider, ProviderSettingsSchema);
    }
    this.validators.set('qwen', QwenProviderSettingsSchema);
    this.validators.set('global', GlobalSettingsSchema);
  }

  private async loadSettingsFromRepository(): Promise<void> {
    try {
      const rawSettings = await this.repository.load();
      if (!rawSettings || Object.keys(rawSettings).length === 0) {
        this.loadDefaultSettings();
        return;
      }

      const validationResult = GlobalSettingsSchema.safeParse(rawSettings);
      if (!validationResult.success) {
        this.loadDefaultSettings();
        return;
      }

      this.settings = validationResult.data as GlobalSettings;
    } catch (_error) {
      this.loadDefaultSettings();
    }
  }

  private loadDefaultSettings(): void {
    // Start with empty settings - runtime config should populate this
    this.settings = {
      providers: {},
    };
  }

  private setupFileWatcher(): void {
    try {
      this.repository.watch((settings: GlobalSettings) => {
        this.settings = settings;
      });
    } catch (_error) {
      // File watcher setup failed
    }
  }

  /**
   * Get current global settings
   */
  getSettings(): Promise<GlobalSettings>;
  getSettings(provider: string): Promise<ProviderSettings>;
  async getSettings(
    provider?: string,
  ): Promise<GlobalSettings | ProviderSettings> {
    // For backward compatibility, try to load from repository first if we haven't loaded yet
    if (!this.isInitialized) {
      throw new Error('SettingsService not initialized');
    }

    // Load from repository if we detect this might be the first call
    try {
      const rawSettings = await this.repository.load();
      if (rawSettings && Object.keys(rawSettings).length > 0) {
        const validationResult = GlobalSettingsSchema.safeParse(rawSettings);
        if (validationResult.success) {
          this.settings = validationResult.data as GlobalSettings;
        }
      }
    } catch (_error) {
      // Use defaults if repository fails
    }

    if (provider === undefined) {
      // Return deep clone of all settings (cached)
      return structuredClone(this.settings);
    }

    // Return provider-specific settings
    if (this.settings.providers[provider] === undefined) {
      this.createDefaultProviderSettings(provider);
    }

    return structuredClone(this.settings.providers[provider]);
  }

  private createDefaultProviderSettings(provider: string): void {
    const defaultSettings = this.getDefaultProviderSettings(provider);
    this.settings.providers[provider] = defaultSettings;

    try {
      this.persistSettingsToRepository();
    } catch (_error) {
      // Failed to persist default provider settings
    }
  }

  /**
   * Update global settings (partial update)
   */
  updateSettings(changes: Partial<GlobalSettings>): Promise<void>;
  updateSettings(
    provider: string,
    changes: Partial<ProviderSettings>,
  ): Promise<void>;
  async updateSettings(
    changesOrProvider: Partial<GlobalSettings> | string,
    providerChanges?: Partial<ProviderSettings>,
  ): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('SettingsService not initialized');
    }

    // Handle both signatures
    if (typeof changesOrProvider === 'string') {
      // New signature: updateSettings(provider: string, changes: Partial<ProviderSettings>)
      const provider = changesOrProvider;
      const changes = providerChanges!;
      return new Promise<void>((resolve, reject) => {
        const operation: UpdateOperation = {
          type: 'update',
          provider,
          changes,
          resolve,
          reject,
        };
        this.enqueueOperation(operation);
      });
    } else {
      // Original signature: updateSettings(changes: Partial<GlobalSettings>)
      const changes = changesOrProvider;
      return new Promise<void>((resolve, reject) => {
        const operation: UpdateOperation = {
          type: 'update',
          changes,
          resolve,
          reject,
        };
        this.enqueueOperation(operation);
      });
    }
  }

  private enqueueOperation(operation: Operation): void {
    this.operationQueue.push(operation);

    if (!this.isProcessingQueue) {
      this.processOperationQueue().catch((error) => {
        console.error('Failed to process operation queue:', error);
      });
    }
  }

  private async processOperationQueue(): Promise<void> {
    if (this.isProcessingQueue) {
      return; // Already processing
    }

    this.isProcessingQueue = true;

    while (this.operationQueue.length > 0) {
      const operation = this.operationQueue.shift();
      if (!operation) continue;

      try {
        switch (operation.type) {
          case 'update':
            await this.processUpdateOperation(operation as UpdateOperation);
            operation.resolve();
            break;

          case 'switch':
            await this.processSwitchOperation(operation as SwitchOperation);
            operation.resolve();
            break;

          default:
            throw new Error(
              `Unknown operation type: ${(operation as Operation).type}`,
            );
        }
      } catch (error) {
        operation.reject(error as Error);
      }
    }

    this.isProcessingQueue = false;
  }

  private async processUpdateOperation(
    operation: UpdateOperation,
  ): Promise<void> {
    const changes = operation.changes;

    // If provider is specified, convert to global settings update
    if (
      operation.provider &&
      typeof changes === 'object' &&
      !('providers' in changes)
    ) {
      // This is a provider-specific update
      const provider = operation.provider;
      const providerChanges = changes as Partial<ProviderSettings>;

      // VALIDATION PHASE
      const currentSettings = this.settings.providers[provider] || {
        enabled: true, // Default to enabled for new providers
      };
      const mergedSettings = { ...currentSettings, ...providerChanges };

      const validator = this.validators.get(provider);
      if (!validator) {
        throw new Error(`No validator found for provider: ${provider}`);
      }

      const validationResult = validator.safeParse(mergedSettings);
      if (!validationResult.success) {
        const errorMsg = `Validation failed for ${provider}: ${validationResult.error.message}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      const validatedSettings = validationResult.data;

      // TRANSACTION BEGIN - Create backup
      this.backupSettings = structuredClone(this.settings);

      try {
        // MEMORY UPDATE PHASE
        this.settings.providers[provider] = validatedSettings;

        // PERSISTENCE PHASE
        await this.persistSettingsToRepository();

        // EVENT EMISSION PHASE
        const changeEvent: SettingsChangeEvent = {
          type: 'settings_changed',
          changes: {
            providers: { [provider]: providerChanges as ProviderSettings },
          },
          timestamp: new Date(),
        };

        this.emit('settings_changed', changeEvent);

        // TRANSACTION COMMIT - Clear backup
        this.backupSettings = null;
      } catch (error) {
        // TRANSACTION ROLLBACK
        if (this.backupSettings !== null) {
          this.settings = this.backupSettings;
          this.backupSettings = null;
        }

        const errorEvent = {
          type: 'settings-error',
          provider,
          error: (error as Error).message,
          timestamp: new Date(),
        };

        this.emit('settings-error' as never, errorEvent);
        throw error;
      }
    } else {
      // This is the original global settings update - use the existing implementation
      await this.processGlobalUpdateOperation(
        changes as Partial<GlobalSettings>,
      );
    }
  }

  private async processGlobalUpdateOperation(
    changes: Partial<GlobalSettings>,
  ): Promise<void> {
    // VALIDATION PHASE - Line 143-162: VALIDATE changes with provider validator
    if (changes.providers) {
      for (const [provider, providerSettings] of Object.entries(
        changes.providers,
      )) {
        const validator = this.validators.get(provider);
        if (!validator) {
          throw new Error(`No validator found for provider: ${provider}`);
        }

        // For qwen, validate the update itself to ensure required fields are present
        if (provider === 'qwen') {
          const validationResult = validator.safeParse(providerSettings);
          if (!validationResult.success) {
            throw new Error(
              `Validation failed for ${provider}: ${validationResult.error.message}`,
            );
          }
        } else {
          // For other providers, validate the merged settings
          const currentSettings = this.settings.providers[provider] || {};
          const mergedSettings = { ...currentSettings, ...providerSettings };

          const validationResult = validator.safeParse(mergedSettings);
          if (!validationResult.success) {
            throw new Error(
              `Validation failed for ${provider}: ${validationResult.error.message}`,
            );
          }
        }
      }
    }

    // Validate global settings
    const mergedGlobalSettings = { ...this.settings, ...changes };
    const globalValidation =
      GlobalSettingsSchema.safeParse(mergedGlobalSettings);
    if (!globalValidation.success) {
      throw new Error(
        `Global settings validation failed: ${globalValidation.error.message}`,
      );
    }

    // Line 165: BEGIN transaction (backup current)
    const backup = structuredClone(this.settings);

    try {
      // Line 166-189: CLONE, MERGE, PERSIST with retry logic
      // Deep merge the settings to preserve existing fields
      if (changes.providers) {
        // Merge provider settings individually to preserve existing fields
        for (const [provider, providerSettings] of Object.entries(
          changes.providers,
        )) {
          if (!this.settings.providers[provider]) {
            this.settings.providers[provider] = { ...providerSettings };
          } else {
            this.settings.providers[provider] = {
              ...this.settings.providers[provider],
              ...providerSettings,
            };
          }
        }
      }

      // Merge other top-level fields
      if (changes.defaultProvider !== undefined) {
        this.settings.defaultProvider = changes.defaultProvider;
      }
      if (changes.ui !== undefined) {
        this.settings.ui = { ...this.settings.ui, ...changes.ui };
      }
      if (changes.telemetry !== undefined) {
        this.settings.telemetry = {
          ...this.settings.telemetry,
          ...changes.telemetry,
        };
      }
      if (changes.advanced !== undefined) {
        this.settings.advanced = {
          ...this.settings.advanced,
          ...changes.advanced,
        };
      }

      await this.persistSettingsToRepository();

      // Line 191-207: UPDATE memory and EMIT event
      const changeEvent: SettingsChangeEvent = {
        type: 'settings_changed',
        changes,
        timestamp: new Date(),
      };

      this.emit('settings_changed', changeEvent);
    } catch (error) {
      // Line 209-225: ON ERROR rollback
      this.settings = backup;
      throw error;
    }
  }

  private async persistSettingsToRepository(): Promise<void> {
    // Line 227-257: Handle file system errors with exponential backoff
    const maxRetries = 5;
    let retryDelay = 100;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.repository.save(this.settings);
        return;
      } catch (error) {
        if (attempt === maxRetries) {
          throw new Error(
            `Failed to persist settings after ${maxRetries} attempts: ${(error as Error).message}`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryDelay *= 2;
      }
    }
  }

  /**
   * Switch to a different provider and update settings
   */
  async switchProvider(newProvider: string): Promise<IProvider> {
    if (!this.isInitialized) {
      throw new Error('SettingsService not initialized');
    }

    return new Promise<IProvider>((resolve, reject) => {
      const operation: SwitchOperation = {
        type: 'switch',
        newProvider,
        resolve: () => resolve({} as IProvider), // Maintain backward compatibility
        reject,
      };
      this.enqueueOperation(operation);
    });
  }

  private async processSwitchOperation(
    operation: SwitchOperation,
  ): Promise<void> {
    const newProvider = operation.newProvider;
    const oldProvider = this.settings.defaultProvider;

    if (newProvider === oldProvider) {
      return;
    }

    // VALIDATION PHASE
    let providerSettings = this.settings.providers[newProvider];
    if (providerSettings === undefined) {
      this.createDefaultProviderSettings(newProvider);
      providerSettings = this.settings.providers[newProvider];
    }

    const validator = this.validators.get(newProvider);
    if (!validator) {
      throw new Error(`No validator found for provider: ${newProvider}`);
    }

    const validationResult = validator.safeParse(providerSettings);
    if (!validationResult.success) {
      throw new Error(
        `Provider configuration invalid: ${validationResult.error.message}`,
      );
    }

    // Special handling for Qwen provider
    if (newProvider === 'qwen') {
      this.validateQwenConfiguration(providerSettings);
    }

    // TRANSACTION BEGIN - Create backup
    this.backupSettings = structuredClone(this.settings);

    try {
      // ATOMIC UPDATE PHASE
      this.settings.defaultProvider = newProvider;

      // PERSISTENCE PHASE
      await this.persistSettingsToRepository();

      // EVENT EMISSION PHASE
      const switchEvent = {
        type: 'provider-switch',
        oldProvider,
        newProvider,
        timestamp: new Date(),
      };

      this.emit('provider-switched' as never, switchEvent);

      // TRANSACTION COMMIT - Clear backup
      this.backupSettings = null;
    } catch (error) {
      // TRANSACTION ROLLBACK
      if (this.backupSettings !== null) {
        this.settings = this.backupSettings;
        this.backupSettings = null;
      }

      const errorEvent = {
        type: 'provider-switch-error',
        oldProvider,
        attemptedProvider: newProvider,
        error: (error as Error).message,
        timestamp: new Date(),
      };

      this.emit('provider-switch-error' as never, errorEvent);
      throw error;
    }
  }

  private validateQwenConfiguration(settings: ProviderSettings): void {
    if (settings.baseUrl === undefined || settings.baseUrl === '') {
      throw new Error('Qwen provider requires baseUrl configuration');
    }

    if (settings.model === undefined || settings.model === '') {
      throw new Error('Qwen provider requires model configuration');
    }

    if (
      settings.baseUrl &&
      !settings.baseUrl.match(/^https:\/\/.*qwen.*\/v1$/)
    ) {
      console.warn('Qwen baseUrl format may be incorrect:', settings.baseUrl);
    }
  }

  private getDefaultProviderSettings(_provider: string): ProviderSettings {
    // No hardcoded defaults - settings should come from actual runtime config
    return {
      enabled: true,
    };
  }

  /**
   * Subscribe to settings change events
   */
  onSettingsChanged(
    listener: EventListener<SettingsChangeEvent>,
  ): EventUnsubscribe {
    super.on('settings_changed', listener);
    return () => {
      this.removeListener('settings_changed', listener);
    };
  }

  /**
   * Subscribe to settings change events (legacy method for interface compatibility)
   */
  on(
    event: 'settings_changed',
    listener: EventListener<SettingsChangeEvent>,
  ): EventUnsubscribe;
  on(eventName: string | symbol, listener: (...args: unknown[]) => void): this;
  on(
    event: string | symbol | 'settings_changed',
    listener:
      | ((...args: unknown[]) => void)
      | EventListener<SettingsChangeEvent>,
  ): EventUnsubscribe | this {
    if (event === 'settings_changed') {
      return this.onSettingsChanged(
        listener as EventListener<SettingsChangeEvent>,
      );
    }
    super.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Emit a settings change event (legacy method for interface compatibility)
   */
  emit(event: 'settings_changed', data: SettingsChangeEvent): void;
  emit(eventName: string | symbol, ...args: unknown[]): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean | void {
    if (event === 'settings_changed') {
      super.emit(event, ...args);
      return;
    }
    return super.emit(event, ...args);
  }

  /**
   * Get comprehensive diagnostics data from centralized source
   */
  async getDiagnosticsData(): Promise<DiagnosticsInfo> {
    if (!this.isInitialized) {
      throw new Error('SettingsService not initialized');
    }

    const currentSettings = await this.getSettings();
    const activeProvider = currentSettings.defaultProvider || 'openai';
    const providerSettings = currentSettings.providers[activeProvider];

    if (!providerSettings) {
      throw new Error(`No settings found for provider: ${activeProvider}`);
    }

    return {
      provider: activeProvider,
      model: providerSettings.model || 'unknown',
      profile: this.currentProfileName,
      providerSettings,
      ephemeralSettings: {}, // This would need to be populated from Config in a real implementation
      modelParams: {
        temperature: providerSettings.temperature,
        maxTokens: providerSettings.maxTokens,
      },
      allSettings: currentSettings,
    };
  }

  /**
   * Export current settings for profile storage
   */
  async exportForProfile(): Promise<{
    defaultProvider: string;
    providers: Record<string, ProviderSettings>;
    ui?: UISettings;
    telemetry?: TelemetrySettings;
    advanced?: AdvancedSettings;
  }> {
    const currentSettings = await this.getSettings();

    // Return a clean copy without internal fields
    return {
      defaultProvider: currentSettings.defaultProvider || 'openai',
      providers: currentSettings.providers,
      ui: currentSettings.ui || undefined,
      telemetry: currentSettings.telemetry || undefined,
      advanced: currentSettings.advanced || undefined,
    };
  }

  /**
   * Import settings from profile data
   */
  async importFromProfile(profileData: {
    defaultProvider: string;
    providers: Record<string, ProviderSettings>;
    ui?: UISettings;
    telemetry?: TelemetrySettings;
    advanced?: AdvancedSettings;
  }): Promise<void> {
    // Validate the profile data first
    const validationResult = GlobalSettingsSchema.safeParse(profileData);
    if (!validationResult.success) {
      throw new Error(
        `Invalid profile data: ${validationResult.error.message}`,
      );
    }

    // Update settings using the existing updateSettings method
    await this.updateSettings(profileData);

    // Emit profile loaded event
    this.emit('profile-loaded' as never, {
      type: 'profile-loaded',
      profileName: this.currentProfileName,
      timestamp: new Date(),
    });
  }

  /**
   * Set the current profile name (for tracking)
   */
  setCurrentProfileName(profileName: string | null): void {
    this.currentProfileName = profileName;
  }

  /**
   * Get the current profile name
   */
  getCurrentProfileName(): string | null {
    return this.currentProfileName;
  }
}
