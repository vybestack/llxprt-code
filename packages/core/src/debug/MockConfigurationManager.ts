/**
 * @plan PLAN-20250120-DEBUGLOGGING.P05
 * @requirement REQ-001,REQ-002
 * Mock implementation for DebugLogger testing
 */

export interface DebugSettings {
  enabled: boolean;
  namespaces: string[];
  level?: string;
  output?: {
    target: string;
    directory?: string;
  };
  redactPatterns?: string[];
}

export class MockConfigurationManager {
  private static instance: MockConfigurationManager;
  private config: DebugSettings = {
    enabled: true,
    namespaces: ['*'],
    level: 'debug',
    output: { target: 'file stderr', directory: '~/.llxprt/debug' },
    redactPatterns: ['apiKey', 'token', 'password'],
  };
  private listeners = new Set<() => void>();

  static getInstance(): MockConfigurationManager {
    if (!MockConfigurationManager.instance) {
      MockConfigurationManager.instance = new MockConfigurationManager();
    }
    return MockConfigurationManager.instance;
  }

  setEphemeralConfig(config: Partial<DebugSettings>): void {
    this.config = { ...this.config, ...config };
    this.notifyListeners();
  }

  getEffectiveConfig(): DebugSettings {
    return this.config;
  }

  getOutputTarget(): string {
    return this.config.output?.target || 'file stderr';
  }

  getRedactPatterns(): string[] {
    return this.config.redactPatterns || [];
  }

  subscribe(listener: () => void): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: () => void): void {
    this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener());
  }
}
