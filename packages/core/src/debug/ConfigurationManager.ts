/**
 * @plan:PLAN-20250120-DEBUGLOGGING.P08
 * @requirement REQ-003,REQ-007
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LLXPRT_DIR } from '../utils/paths.js';
import { DebugSettings } from './types.js';

export class ConfigurationManager {
  // Line 11: PRIVATE static instance: ConfigurationManager
  private static instance: ConfigurationManager | undefined;

  // Line 12-18: Private configuration properties
  private defaultConfig: DebugSettings;
  private projectConfig: Partial<DebugSettings> | null = null;
  private userConfig: Partial<DebugSettings> | null = null;
  private envConfig: Partial<DebugSettings> | null = null;
  private cliConfig: Partial<DebugSettings> | null = null;
  private ephemeralConfig: Partial<DebugSettings> | null = null;
  private mergedConfig!: DebugSettings;
  private listeners: Set<() => void> = new Set();

  // Line 21-26: Singleton getInstance()
  static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  // Line 28-40: Constructor with default config
  private constructor() {
    this.defaultConfig = {
      enabled: false,
      namespaces: [],
      level: 'info',
      output: { target: 'file', directory: `~/${LLXPRT_DIR}/debug` },
      lazyEvaluation: true,
      redactPatterns: ['apiKey', 'token', 'password'],
    };
    this.listeners = new Set();
    this.loadConfigurations();
    this.mergeConfigurations();
  }

  // Line 42-46: Load all configurations
  loadConfigurations(): void {
    this.loadEnvironmentConfig();
    this.loadUserConfig();
    this.loadProjectConfig();
  }

  // Line 47-64: Load environment config (support DEBUG and LLXPRT_DEBUG)
  private loadEnvironmentConfig(): void {
    if (process.env.DEBUG) {
      const namespaces = this.parseDebugEnv(process.env.DEBUG);
      // Only enable if DEBUG contains llxprt namespaces
      const llxprtNamespaces = namespaces.filter(
        (ns) => ns.startsWith('llxprt') || ns === '*',
      );
      if (llxprtNamespaces.length > 0) {
        this.envConfig = {
          enabled: true,
          namespaces: llxprtNamespaces,
        };
      }
    }

    if (process.env.LLXPRT_DEBUG) {
      const namespaces = this.parseDebugEnv(process.env.LLXPRT_DEBUG);
      this.envConfig = {
        enabled: true,
        namespaces,
      };
    }

    // Support other LLXPRT environment variables
    if (process.env.DEBUG_ENABLED) {
      this.envConfig = {
        ...this.envConfig,
        enabled: process.env.DEBUG_ENABLED === 'true',
      };
    }

    if (process.env.DEBUG_LEVEL) {
      this.envConfig = { ...this.envConfig, level: process.env.DEBUG_LEVEL };
    }

    if (process.env.DEBUG_OUTPUT) {
      this.envConfig = {
        ...this.envConfig,
        output: { target: process.env.DEBUG_OUTPUT },
      };
    }
  }

  // Line 66-79: Load user config from ~/.llxprt/settings.json
  private loadUserConfig(): void {
    try {
      const homeDir = os.homedir();
      if (!homeDir) {
        // In test environments, os.homedir() might not be available
        return;
      }
      const configPath = path.join(homeDir, LLXPRT_DIR, 'settings.json');
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, 'utf8');
          const parsed = JSON.parse(content);
          if (parsed.debug) {
            this.userConfig = parsed.debug;
          }
        } catch (error) {
          console.warn('Failed to load user config:', error);
        }
      }
    } catch (_error) {
      // Silently skip if we can't determine home directory (e.g., in tests)
      // This allows the debug system to work with default config
    }
  }

  // Line 81-94: Load project config from .llxprt/config.json
  private loadProjectConfig(): void {
    try {
      const cwd = process.cwd();
      if (!cwd) {
        return;
      }
      const configPath = path.join(cwd, LLXPRT_DIR, 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, 'utf8');
          const parsed = JSON.parse(content);
          if (parsed.debug) {
            this.projectConfig = parsed.debug;
          }
        } catch (error) {
          console.warn('Failed to load project config:', error);
        }
      }
    } catch (_error) {
      // Silently skip if we can't determine working directory (e.g., in tests)
    }
  }

  // Line 96-111: Merge configurations in priority order
  private mergeConfigurations(): void {
    const configs = [
      this.defaultConfig,
      this.projectConfig,
      this.userConfig,
      this.envConfig,
      this.cliConfig,
      this.ephemeralConfig,
    ].filter(Boolean) as Array<Partial<DebugSettings>>;

    this.mergedConfig = configs.reduce(
      (merged, config) => Object.assign({}, merged, config),
      {},
    ) as DebugSettings;

    // Notify all listeners of configuration change
    this.listeners.forEach((listener) => listener());
  }

  // Line 113-121: Set CLI and ephemeral configs
  setCliConfig(config: Partial<DebugSettings>): void {
    this.cliConfig = config;
    this.mergeConfigurations();
  }

  setEphemeralConfig(config: Partial<DebugSettings>): void {
    this.ephemeralConfig = {
      ...this.ephemeralConfig,
      ...config,
    };
    this.mergeConfigurations();
  }

  // Line 123-150: Persist ephemeral to user config
  persistEphemeralConfig(): void {
    if (!this.ephemeralConfig) {
      return;
    }

    const userConfigPath = path.join(os.homedir(), LLXPRT_DIR, 'settings.json');
    let existing: Record<string, unknown> = {};

    if (fs.existsSync(userConfigPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
      } catch {
        existing = {};
      }
    }

    existing.debug = Object.assign({}, existing.debug, this.ephemeralConfig);

    try {
      fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
      fs.writeFileSync(userConfigPath, JSON.stringify(existing, null, 2));
      this.userConfig = existing.debug as Partial<DebugSettings>;
      this.ephemeralConfig = null;
      this.mergeConfigurations();
    } catch (_error) {
      throw new Error('Failed to persist configuration');
    }
  }

  // Line 152-174: Getters and subscription management
  getEffectiveConfig(): DebugSettings {
    return this.mergedConfig;
  }

  getOutputTarget(): string {
    const output = this.mergedConfig.output;
    if (typeof output === 'string') {
      return output;
    }
    return output.target;
  }

  getRedactPatterns(): string[] {
    return this.mergedConfig.redactPatterns;
  }

  subscribe(listener: () => void): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: () => void): void {
    this.listeners.delete(listener);
  }

  private parseDebugEnv(value: string): string[] {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
