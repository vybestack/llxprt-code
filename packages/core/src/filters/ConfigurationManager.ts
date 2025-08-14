/**
 * ConfigurationManager - Manages emoji filter configuration with hierarchy and persistence
 * Phase 06 implementation based on pseudocode lines 01-86
 */

import type { SettingsService } from '../settings/SettingsService.js';
import type { Config } from '../config/config.js';

/**
 * Emoji filter modes
 */
export type EmojiFilterMode = 'allowed' | 'auto' | 'warn' | 'error';

/**
 * Internal configuration state structure
 */
interface ConfigurationState {
  /** Current effective mode */
  mode: EmojiFilterMode;
  /** Source of current configuration */
  source: 'default' | 'profile' | 'session';
  /** Session override if present */
  sessionOverride?: EmojiFilterMode;
  /** Profile configuration if loaded */
  profileConfig?: EmojiFilterMode;
  /** Default configuration */
  defaultConfig: EmojiFilterMode;
}

/**
 * Configuration manager for emoji filter settings
 * Implements singleton pattern with configuration hierarchy: Session > Profile > Default
 */
export class ConfigurationManager {
  private static instance: ConfigurationManager | null = null;
  private state: ConfigurationState;
  private settingsService: SettingsService | null = null;
  private config: Config | null = null;

  /**
   * Private constructor for singleton pattern
   */
  private constructor() {
    // Initialize with default configuration
    this.state = {
      mode: 'auto',
      source: 'default',
      defaultConfig: 'auto',
    };
  }

  /**
   * Get singleton instance
   * @returns ConfigurationManager instance
   */
  static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  /**
   * Initialize with config and settings service
   * @param config Application config instance
   * @param settingsService Settings service instance
   */
  initialize(config: Config, settingsService: SettingsService): void {
    this.config = config;
    this.settingsService = settingsService;

    // Load profile configuration if available
    this.loadDefaultConfiguration();
  }

  /**
   * Get current emoji filter configuration
   * Implements configuration hierarchy: Session > Profile > Default
   * @returns Current configuration state
   * @pseudocode lines 14-30
   */
  getConfiguration(): ConfigurationState {
    // Update effective mode based on hierarchy
    let effectiveMode: EmojiFilterMode;
    let source: ConfigurationState['source'];

    // Priority 1: Session override
    if (this.state.sessionOverride) {
      effectiveMode = this.state.sessionOverride;
      source = 'session';
    }
    // Priority 2: Profile configuration
    else if (this.state.profileConfig) {
      effectiveMode = this.state.profileConfig;
      source = 'profile';
    }
    // Priority 3: Default configuration
    else {
      effectiveMode = this.state.defaultConfig;
      source = 'default';
    }

    return {
      ...this.state,
      mode: effectiveMode,
      source,
    };
  }

  /**
   * Set session override for emoji filter mode
   * @param mode Mode to set as session override
   * @returns true if successful, false otherwise
   * @pseudocode lines 32-45
   */
  setSessionOverride(mode: EmojiFilterMode): boolean {
    // Validate mode
    const validModes: EmojiFilterMode[] = ['allowed', 'auto', 'warn', 'error'];
    if (!validModes.includes(mode)) {
      console.error(`Invalid emoji filter mode: ${mode}`);
      return false;
    }

    try {
      // Set session override
      this.state.sessionOverride = mode;

      // Update effective mode
      this.state.mode = mode;
      this.state.source = 'session';

      return true;
    } catch (error) {
      console.error('Failed to set session override:', error);
      return false;
    }
  }

  /**
   * Clear session override, reverting to profile or default
   * @returns true if successful, false otherwise
   * @pseudocode lines 47-53
   */
  clearSessionOverride(): boolean {
    try {
      // Clear session override
      this.state.sessionOverride = undefined;

      // Recalculate effective configuration
      const config = this.getConfiguration();
      this.state.mode = config.mode;
      this.state.source = config.source;

      return true;
    } catch (error) {
      console.error('Failed to clear session override:', error);
      return false;
    }
  }

  /**
   * Load default configuration from settings service
   * @returns true if successful, false otherwise
   * @pseudocode lines 55-70
   */
  loadDefaultConfiguration(): boolean {
    if (!this.settingsService) {
      console.warn('Settings service not available, using built-in default');
      return true; // Built-in default already set in constructor
    }

    try {
      // Try to load from settings service
      const storedMode = this.settingsService.get('emojiFilter.mode') as
        | EmojiFilterMode
        | undefined;

      if (
        storedMode &&
        ['allowed', 'auto', 'warn', 'error'].includes(storedMode)
      ) {
        this.state.profileConfig = storedMode;

        // Update effective mode if no session override
        if (!this.state.sessionOverride) {
          this.state.mode = storedMode;
          this.state.source = 'profile';
        }
      }

      return true;
    } catch (error) {
      console.error('Failed to load configuration from settings:', error);
      return false;
    }
  }

  /**
   * Save current configuration to profile via settings service
   * @returns true if successful, false otherwise
   * @pseudocode lines 72-86
   */
  saveToProfile(): boolean {
    if (!this.settingsService) {
      console.error('Settings service not available for profile save');
      return false;
    }

    try {
      // Save current effective mode to profile
      const currentConfig = this.getConfiguration();
      this.settingsService.set('emojiFilter.mode', currentConfig.mode);

      // Update profile config state
      this.state.profileConfig = currentConfig.mode;

      // If no session override, update source
      if (!this.state.sessionOverride) {
        this.state.source = 'profile';
      }

      return true;
    } catch (error) {
      console.error('Failed to save configuration to profile:', error);
      return false;
    }
  }

  /**
   * Get current emoji filter mode (convenience method)
   * @returns Current effective emoji filter mode
   */
  getCurrentMode(): EmojiFilterMode {
    return this.getConfiguration().mode;
  }

  /**
   * Check if current mode allows emojis
   * @returns true if emojis are allowed, false otherwise
   */
  isAllowed(): boolean {
    return this.getCurrentMode() === 'allowed';
  }

  /**
   * Check if current mode should warn about emojis
   * @returns true if warnings should be shown, false otherwise
   */
  shouldWarn(): boolean {
    return this.getCurrentMode() === 'warn';
  }

  /**
   * Check if current mode should error on emojis
   * @returns true if errors should be thrown, false otherwise
   */
  shouldError(): boolean {
    return this.getCurrentMode() === 'error';
  }

  /**
   * Reset configuration to defaults (for testing)
   * @internal
   */
  _resetForTesting(): void {
    this.state = {
      mode: 'auto',
      source: 'default',
      defaultConfig: 'auto',
    };
    this.settingsService = null;
    this.config = null;
  }
}
