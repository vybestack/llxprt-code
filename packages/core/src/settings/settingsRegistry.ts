export const PLAN_MARKER = '@plan:PLAN-20260126-SETTINGS-SEPARATION.P05';

export type SettingCategory =
  | 'model-behavior'
  | 'provider-config'
  | 'cli-behavior'
  | 'model-param'
  | 'custom-header';

export interface ValidationResult {
  success: boolean;
  value?: unknown;
  message?: string;
}

export interface SettingSpec {
  key: string;
  aliases?: readonly string[];
  category: SettingCategory;
  providers?: readonly string[];
  description: string;
  hint?: string;
  type: 'boolean' | 'number' | 'string' | 'enum' | 'json' | 'string-array';
  enumValues?: readonly string[];
  validate?: (value: unknown) => ValidationResult;
  parse?: (raw: string) => unknown;
  normalize?: (value: unknown) => unknown;
  default?: unknown;
  persistToProfile: boolean;
  completionOptions?: ReadonlyArray<{ value: string; description?: string }>;
}

export interface SeparatedSettings {
  cliSettings: Record<string, unknown>;
  modelBehavior: Record<string, unknown>;
  modelParams: Record<string, unknown>;
  customHeaders: Record<string, string>;
}

const ALIAS_NORMALIZATION_RULES: Record<string, string> = {
  'max-tokens': 'max_tokens',
  maxTokens: 'max_tokens',
  'response-format': 'response_format',
  responseFormat: 'response_format',
  'tool-choice': 'tool_choice',
  toolChoice: 'tool_choice',
  'disabled-tools': 'tools.disabled',
};

const HEADER_PRESERVE_SET = new Set([
  'user-agent',
  'content-type',
  'authorization',
  'x-api-key',
]);

export const SETTINGS_REGISTRY: readonly SettingSpec[] = [
  {
    key: 'apiKey',
    aliases: ['api-key'],
    category: 'provider-config',
    description: 'Provider API authentication key',
    type: 'string',
    persistToProfile: false,
  },
  {
    key: 'auth-key',
    category: 'provider-config',
    description: 'Auth key alias (saved to profiles for auth persistence)',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'apiKeyfile',
    aliases: ['api-keyfile'],
    category: 'provider-config',
    description: 'Path to file containing API key',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'auth-keyfile',
    category: 'provider-config',
    description: 'Auth keyfile alias (saved to profiles for auth persistence)',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'baseUrl',
    aliases: ['baseURL', 'base-url'],
    category: 'provider-config',
    description: 'Provider API base URL',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'model',
    category: 'provider-config',
    description: 'Default model name',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'defaultModel',
    category: 'provider-config',
    description: 'Fallback model if primary unavailable',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'enabled',
    category: 'provider-config',
    description: 'Enable/disable provider',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'toolFormat',
    aliases: ['tool-format'],
    category: 'provider-config',
    description: 'Tool format preference',
    type: 'enum',
    enumValues: [
      'auto',
      'openai',
      'anthropic',
      'qwen',
      'kimi',
      'hermes',
      'xml',
      'deepseek',
      'gemma',
      'llama',
    ],
    persistToProfile: true,
  },
  {
    key: 'toolFormatOverride',
    aliases: ['tool-format-override'],
    category: 'provider-config',
    description: 'Force specific tool format',
    type: 'enum',
    enumValues: [
      'auto',
      'openai',
      'anthropic',
      'qwen',
      'kimi',
      'hermes',
      'xml',
      'deepseek',
      'gemma',
      'llama',
    ],
    persistToProfile: true,
  },
  {
    key: 'api-version',
    category: 'cli-behavior',
    description: 'API version to use',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'reasoning.enabled',
    category: 'model-behavior',
    description: 'Enable thinking/reasoning for models that support it',
    type: 'boolean',
    persistToProfile: true,
    completionOptions: [
      { value: 'true', description: 'Enable thinking' },
      { value: 'false', description: 'Disable thinking' },
    ],
  },
  {
    key: 'reasoning.effort',
    category: 'model-behavior',
    description:
      'How much the model should think before responding (minimal/low/medium/high/xhigh)',
    type: 'enum',
    enumValues: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    persistToProfile: true,
  },
  {
    key: 'reasoning.maxTokens',
    category: 'model-behavior',
    description: 'Maximum token budget for reasoning',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'reasoning.budgetTokens',
    category: 'model-behavior',
    description: 'Token budget for reasoning (Anthropic-specific)',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'reasoning.adaptiveThinking',
    category: 'model-behavior',
    description:
      'Enable adaptive thinking for Anthropic Opus 4.6+ (true/false)',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'reasoning.includeInResponse',
    category: 'cli-behavior',
    description: 'Show thinking blocks in UI output',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'reasoning.includeInContext',
    category: 'cli-behavior',
    description: 'Keep thinking in conversation history',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'reasoning.stripFromContext',
    category: 'cli-behavior',
    description: 'Remove thinking blocks from context (all/allButLast/none)',
    type: 'enum',
    enumValues: ['all', 'allButLast', 'none'],
    persistToProfile: true,
  },
  {
    key: 'reasoning.format',
    category: 'cli-behavior',
    description: 'API format for reasoning (native/field)',
    type: 'enum',
    enumValues: ['native', 'field'],
    persistToProfile: true,
  },
  {
    key: 'reasoning.summary',
    category: 'model-behavior',
    description:
      'OpenAI Responses API reasoning summary mode (auto/concise/detailed/none)',
    type: 'enum',
    enumValues: ['auto', 'concise', 'detailed', 'none'],
    persistToProfile: true,
  },
  {
    key: 'text.verbosity',
    category: 'model-behavior',
    description:
      'OpenAI Responses API text verbosity for thinking output (low/medium/high)',
    type: 'enum',
    enumValues: ['low', 'medium', 'high'],
    persistToProfile: true,
  },
  {
    key: 'prompt-caching',
    category: 'model-behavior',
    description: 'Enable prompt caching (off/5m/1h/24h)',
    type: 'enum',
    enumValues: ['off', '5m', '1h', '24h'],
    persistToProfile: true,
  },
  {
    key: 'rate-limit-throttle',
    category: 'model-behavior',
    description: 'Enable proactive rate limit throttling (on/off)',
    type: 'enum',
    enumValues: ['on', 'off'],
    persistToProfile: true,
  },
  {
    key: 'rate-limit-throttle-threshold',
    category: 'model-behavior',
    description: 'Percentage threshold for rate limit throttling (1-100)',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'rate-limit-max-wait',
    category: 'model-behavior',
    description: 'Maximum wait time in milliseconds for rate limit throttling',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'shell-replacement',
    category: 'cli-behavior',
    description: 'Command substitution mode for shell tool',
    type: 'string',
    enumValues: ['allowlist', 'all', 'none', 'true', 'false'],
    persistToProfile: true,
  },
  {
    key: 'streaming',
    category: 'cli-behavior',
    description: 'Enable/disable streaming (enabled/disabled)',
    type: 'enum',
    enumValues: ['enabled', 'disabled'],
    persistToProfile: true,
    completionOptions: [
      { value: 'enabled', description: 'Enable streaming' },
      { value: 'disabled', description: 'Disable streaming' },
    ],
    parse: (raw: string) => {
      if (raw === 'true') return 'enabled';
      if (raw === 'false') return 'disabled';
      return raw;
    },
    validate: (value: unknown): ValidationResult => {
      const validModes = ['enabled', 'disabled'];
      if (typeof value === 'string' && validModes.includes(value)) {
        return { success: true, value };
      }
      return {
        success: false,
        message: `Invalid streaming mode '${String(value)}'. Valid modes are: ${validModes.join(', ')}`,
      };
    },
  },
  {
    key: 'context-limit',
    category: 'cli-behavior',
    description: 'Maximum number of tokens for the context window',
    type: 'number',
    hint: 'positive integer (e.g., 100000)',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'context-limit must be a positive integer (e.g., 100000)',
      };
    },
  },
  {
    key: 'compression-threshold',
    category: 'cli-behavior',
    description:
      'Fraction of context limit that triggers compression (0.0-1.0)',
    type: 'number',
    hint: 'decimal between 0 and 1 (e.g., 0.7)',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && value >= 0 && value <= 1) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'compression-threshold must be a decimal between 0 and 1 (e.g., 0.7 for 70%)',
      };
    },
  },
  {
    key: 'tool-output-max-items',
    category: 'cli-behavior',
    description: 'Maximum number of items/files/matches returned by tools',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'tool-output-max-items must be a positive integer',
      };
    },
  },
  {
    key: 'file-read-max-lines',
    category: 'cli-behavior',
    description:
      'Default maximum lines to read from text files when no explicit limit is provided (default: 2000)',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'file-read-max-lines must be a positive integer',
      };
    },
  },
  {
    key: 'tool-output-max-tokens',
    category: 'cli-behavior',
    description: 'Maximum tokens in tool output',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'tool-output-truncate-mode',
    category: 'cli-behavior',
    description: 'How to handle exceeding limits (warn/truncate/sample)',
    type: 'enum',
    enumValues: ['warn', 'truncate', 'sample'],
    persistToProfile: true,
  },
  {
    key: 'tool-output-item-size-limit',
    category: 'cli-behavior',
    description: 'Maximum size per item/file in bytes',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'max-prompt-tokens',
    category: 'cli-behavior',
    description: 'Maximum tokens allowed in any prompt sent to LLM',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'maxTurnsPerPrompt',
    category: 'cli-behavior',
    description:
      'Maximum number of turns allowed per prompt before stopping (default: -1 for unlimited)',
    type: 'number',
    persistToProfile: true,
    default: -1,
    validate: (value: unknown): ValidationResult => {
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        (value === -1 || value > 0)
      ) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'maxTurnsPerPrompt must be a positive integer or -1 for unlimited',
      };
    },
  },
  {
    key: 'loopDetectionEnabled',
    category: 'cli-behavior',
    description: 'Enable/disable all loop detection mechanisms (true/false)',
    type: 'boolean',
    persistToProfile: true,
    default: true,
  },
  {
    key: 'toolCallLoopThreshold',
    category: 'cli-behavior',
    description:
      'Number of consecutive identical tool calls before triggering loop detection (default: 50, -1 = unlimited)',
    type: 'number',
    persistToProfile: true,
    default: 50,
    validate: (value: unknown): ValidationResult => {
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        (value === -1 || value > 0)
      ) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'toolCallLoopThreshold must be a positive integer or -1 for unlimited',
      };
    },
  },
  {
    key: 'contentLoopThreshold',
    category: 'cli-behavior',
    description:
      'Number of content chunk repetitions before triggering loop detection (default: 50, -1 = unlimited)',
    type: 'number',
    persistToProfile: true,
    default: 50,
    validate: (value: unknown): ValidationResult => {
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        (value === -1 || value > 0)
      ) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'contentLoopThreshold must be a positive integer or -1 for unlimited',
      };
    },
  },
  {
    key: 'retries',
    category: 'cli-behavior',
    description: 'Maximum number of retry attempts for API calls',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'retrywait',
    category: 'cli-behavior',
    description: 'Initial delay in milliseconds between retry attempts',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'socket-timeout',
    category: 'cli-behavior',
    description: 'Request timeout in milliseconds for local AI servers',
    type: 'number',
    hint: 'positive integer in milliseconds (e.g., 60000)',
    persistToProfile: true,
  },
  {
    key: 'socket-keepalive',
    category: 'cli-behavior',
    description: 'Enable TCP keepalive for local AI server connections',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'socket-nodelay',
    category: 'cli-behavior',
    description: 'Enable TCP_NODELAY for local AI servers',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'emojifilter',
    category: 'cli-behavior',
    description: 'Emoji filter mode (allowed/auto/warn/error)',
    type: 'enum',
    enumValues: ['allowed', 'auto', 'warn', 'error'],
    persistToProfile: true,
    parse: (raw: string) => raw.toLowerCase(),
  },
  {
    key: 'dumponerror',
    category: 'cli-behavior',
    description:
      'Dump API request body to ~/.llxprt/dumps/ on errors (enabled/disabled)',
    type: 'enum',
    enumValues: ['enabled', 'disabled'],
    persistToProfile: true,
  },
  {
    key: 'dumpcontext',
    category: 'cli-behavior',
    description: 'Control context dumping (now/status/on/error/off)',
    type: 'enum',
    enumValues: ['now', 'status', 'on', 'error', 'off'],
    persistToProfile: true,
  },
  {
    key: 'authOnly',
    category: 'cli-behavior',
    description: 'Force OAuth authentication only',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'todo-continuation',
    category: 'cli-behavior',
    description: 'Enable todo continuation mode',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'tools.disabled',
    aliases: ['disabled-tools'],
    category: 'cli-behavior',
    description: 'Disabled tools list',
    type: 'string-array',
    persistToProfile: true,
  },
  {
    key: 'tools.allowed',
    category: 'cli-behavior',
    description: 'Allowed tools list',
    type: 'string-array',
    persistToProfile: true,
  },
  {
    key: 'stream-options',
    category: 'cli-behavior',
    description: 'Stream options for OpenAI API',
    type: 'json',
    persistToProfile: true,
  },
  {
    key: 'include-folder-structure',
    category: 'cli-behavior',
    description: 'Include folder structure in system prompts',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'enable-tool-prompts',
    category: 'cli-behavior',
    description: 'Load tool-specific prompts from ~/.llxprt/prompts/tools/**',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'task-default-timeout-seconds',
    category: 'cli-behavior',
    description: 'Default timeout in seconds for task tool executions',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && (value === -1 || value > 0)) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'task-default-timeout-seconds must be a positive number in seconds or -1 for unlimited',
      };
    },
  },
  {
    key: 'task-max-timeout-seconds',
    category: 'cli-behavior',
    description: 'Maximum allowed timeout in seconds for task tool executions',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && (value === -1 || value > 0)) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'task-max-timeout-seconds must be a positive number in seconds or -1 for unlimited',
      };
    },
  },
  {
    key: 'shell-default-timeout-seconds',
    category: 'cli-behavior',
    description: 'Default timeout in seconds for shell command executions',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && (value === -1 || value > 0)) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'shell-default-timeout-seconds must be a positive number in seconds or -1 for unlimited',
      };
    },
  },
  {
    key: 'shell-max-timeout-seconds',
    category: 'cli-behavior',
    description:
      'Maximum allowed timeout in seconds for shell command executions',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && (value === -1 || value > 0)) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'shell-max-timeout-seconds must be a positive number in seconds or -1 for unlimited',
      };
    },
  },
  {
    key: 'temperature',
    category: 'model-param',
    description: 'Sampling temperature',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'max_tokens',
    aliases: ['max-tokens', 'maxTokens'],
    category: 'model-param',
    description: 'Maximum tokens to generate',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'max_output_tokens',
    aliases: ['max-output-tokens'],
    category: 'model-param',
    description: 'Maximum output tokens (Gemini native param)',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'maxOutputTokens',
    aliases: ['max-output'],
    category: 'cli-behavior',
    description: 'Maximum output tokens (generic, translated by provider)',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'top_p',
    category: 'model-param',
    description: 'Nucleus sampling',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'top_k',
    category: 'model-param',
    description: 'Top-k sampling',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'frequency_penalty',
    category: 'model-param',
    description: 'Frequency penalty',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'presence_penalty',
    category: 'model-param',
    description: 'Presence penalty',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'seed',
    category: 'model-param',
    providers: ['openai', 'openaivercel'],
    description: 'Random seed for deterministic sampling (OpenAI only)',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'stop',
    category: 'model-param',
    description: 'Stop sequences',
    type: 'string-array',
    persistToProfile: true,
  },
  {
    key: 'response_format',
    aliases: ['response-format', 'responseFormat'],
    category: 'model-param',
    description: 'Response format (e.g., json_object)',
    type: 'json',
    persistToProfile: true,
  },
  {
    key: 'logit_bias',
    category: 'model-param',
    description: 'Token bias',
    type: 'json',
    persistToProfile: true,
  },
  {
    key: 'tool_choice',
    aliases: ['tool-choice', 'toolChoice'],
    category: 'model-param',
    description: 'Tool choice strategy (auto/required/none)',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'reasoning',
    category: 'model-param',
    providers: ['openai', 'openaivercel', 'openai-responses'],
    description: 'Reasoning configuration object (OpenAI)',
    type: 'json',
    persistToProfile: false,
    normalize: (value: unknown): unknown => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
      }
      const sanitized: Record<string, unknown> = {};
      const INTERNAL_KEYS = new Set([
        'enabled',
        'includeInContext',
        'includeInResponse',
        'format',
        'stripFromContext',
      ]);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== undefined && v !== null && !INTERNAL_KEYS.has(k)) {
          sanitized[k] = v;
        }
      }
      return Object.keys(sanitized).length > 0 ? sanitized : undefined;
    },
  },
  {
    key: 'custom-headers',
    category: 'custom-header',
    description: 'Custom HTTP headers as JSON object',
    type: 'json',
    persistToProfile: true,
  },
  {
    key: 'user-agent',
    aliases: ['User-Agent'],
    category: 'custom-header',
    description: 'User-Agent header override',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'GOOGLE_CLOUD_PROJECT',
    category: 'provider-config',
    description: 'Google Cloud project ID',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'GOOGLE_CLOUD_LOCATION',
    category: 'provider-config',
    description: 'Google Cloud location/region',
    type: 'string',
    persistToProfile: true,
  },
  // Load balancer settings (Issue #489)
  {
    key: 'tpm_threshold',
    category: 'cli-behavior',
    description:
      'Minimum tokens per minute before triggering failover (positive integer, load balancer only)',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'tpm_threshold must be a positive integer',
      };
    },
  },
  {
    key: 'timeout_ms',
    category: 'cli-behavior',
    description:
      'Maximum request duration in milliseconds before timeout (positive integer, load balancer only)',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'timeout_ms must be a positive integer',
      };
    },
  },
  {
    key: 'circuit_breaker_enabled',
    category: 'cli-behavior',
    description:
      'Enable circuit breaker pattern for failing backends (true/false, load balancer only)',
    type: 'boolean',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (value === true || value === false) {
        return { success: true, value };
      }
      return {
        success: false,
        message: `circuit_breaker_enabled must be either 'true' or 'false'`,
      };
    },
  },
  {
    key: 'circuit_breaker_failure_threshold',
    category: 'cli-behavior',
    description:
      'Number of failures before opening circuit (positive integer, default: 3, load balancer only)',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'circuit_breaker_failure_threshold must be a positive integer',
      };
    },
  },
  {
    key: 'circuit_breaker_failure_window_ms',
    category: 'cli-behavior',
    description:
      'Time window for counting failures in milliseconds (positive integer, default: 60000, load balancer only)',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'circuit_breaker_failure_window_ms must be a positive integer',
      };
    },
  },
  {
    key: 'circuit_breaker_recovery_timeout_ms',
    category: 'cli-behavior',
    description:
      'Cooldown period before retrying after circuit opens in milliseconds (positive integer, default: 30000, load balancer only)',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'circuit_breaker_recovery_timeout_ms must be a positive integer',
      };
    },
  },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveAlias(key: string): string {
  if (ALIAS_NORMALIZATION_RULES[key]) {
    return ALIAS_NORMALIZATION_RULES[key];
  }

  for (const spec of SETTINGS_REGISTRY) {
    if (spec.aliases?.includes(key)) {
      return spec.key;
    }
  }

  for (const spec of SETTINGS_REGISTRY) {
    if (spec.key === key) {
      return key;
    }
  }

  const lowerKey = key.toLowerCase();
  if (HEADER_PRESERVE_SET.has(lowerKey)) {
    return key;
  }

  return key.replace(/-/g, '_');
}

export function getSettingSpec(key: string): SettingSpec | undefined {
  return SETTINGS_REGISTRY.find((s) => s.key === key);
}

export function normalizeSetting(key: string, value: unknown): unknown {
  const resolvedKey = resolveAlias(key);
  const spec = SETTINGS_REGISTRY.find((s) => s.key === resolvedKey);

  if (spec?.normalize) {
    return spec.normalize(value);
  }

  // Reasoning spec already has normalize, but keep fallback for safety
  // until all reasoning normalization is verified through spec.normalize

  return value;
}

const INTERNAL_SETTINGS_KEYS = new Set([
  'activeProvider',
  'currentProfile',
  'tools',
]);

export function separateSettings(
  mixed: Record<string, unknown>,
  providerName?: string,
): SeparatedSettings {
  const cliSettings: Record<string, unknown> = {};
  const modelBehavior: Record<string, unknown> = {};
  const modelParams: Record<string, unknown> = {};
  const customHeaders: Record<string, string> = {};

  let providerOverrides: Record<string, unknown> = {};
  if (providerName && isPlainObject(mixed[providerName])) {
    providerOverrides = mixed[providerName];
  }

  if (isPlainObject(mixed['custom-headers'])) {
    const globalHeaders = mixed['custom-headers'];
    for (const [headerName, headerValue] of Object.entries(globalHeaders)) {
      if (typeof headerValue === 'string') {
        customHeaders[headerName] = headerValue;
      }
    }
  }

  if (isPlainObject(providerOverrides['custom-headers'])) {
    const providerHeaders = providerOverrides['custom-headers'];
    for (const [headerName, headerValue] of Object.entries(providerHeaders)) {
      if (typeof headerValue === 'string') {
        customHeaders[headerName] = headerValue;
      }
    }
  }

  const effectiveSettings = { ...mixed, ...providerOverrides };

  if (isPlainObject(effectiveSettings['reasoning'])) {
    const reasoningObj = effectiveSettings['reasoning'];

    for (const [subKey, subValue] of Object.entries(reasoningObj)) {
      const fullKey = `reasoning.${subKey}`;

      if (!(fullKey in effectiveSettings)) {
        effectiveSettings[fullKey] = subValue;
      }
    }
  }

  for (const [rawKey, value] of Object.entries(effectiveSettings)) {
    if (value === undefined || value === null) continue;

    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      rawKey === providerName
    ) {
      continue;
    }

    if (rawKey === 'custom-headers') {
      continue;
    }

    if (INTERNAL_SETTINGS_KEYS.has(rawKey)) {
      cliSettings[rawKey] = value;
      continue;
    }

    const resolvedKey = resolveAlias(rawKey);
    const normalizedValue = normalizeSetting(resolvedKey, value);

    if (normalizedValue === undefined) continue;

    const spec = getSettingSpec(resolvedKey);

    if (!spec) {
      // Unknown settings default to model-param (pass-through to API).
      // This allows /set modelparam <anything> <value> to work for
      // provider-specific parameters not yet in the registry.
      modelParams[resolvedKey] = normalizedValue;
      continue;
    }

    if (spec.category === 'model-param' && spec.providers && providerName) {
      if (!spec.providers.includes(providerName)) {
        continue;
      }
    }

    switch (spec.category) {
      case 'provider-config':
        break;
      case 'cli-behavior':
        cliSettings[resolvedKey] = normalizedValue;
        break;
      case 'model-behavior':
        modelBehavior[resolvedKey] = normalizedValue;
        break;
      case 'model-param':
        modelParams[resolvedKey] = normalizedValue;
        break;
      case 'custom-header':
        if (typeof normalizedValue === 'string') {
          customHeaders[resolvedKey] = normalizedValue;
        }
        break;
      default:
        break;
    }
  }

  return { cliSettings, modelBehavior, modelParams, customHeaders };
}

export function validateSetting(key: string, value: unknown): ValidationResult {
  const resolved = resolveAlias(key);
  const spec = getSettingSpec(resolved);

  if (!spec) {
    // Unknown settings are allowed — they pass through as model-params
    return { success: true, value };
  }

  if (spec.validate) {
    return spec.validate(value);
  }

  // Auto-validate enum types if no custom validator
  if (spec.type === 'enum' && spec.enumValues) {
    const strValue = typeof value === 'string' ? value.toLowerCase() : value;
    if (
      typeof strValue !== 'string' ||
      !spec.enumValues.includes(strValue as string)
    ) {
      return {
        success: false,
        message: `${spec.key} must be one of: ${spec.enumValues.join(', ')}`,
      };
    }
    return { success: true, value: strValue };
  }

  // Auto-validate boolean types
  if (spec.type === 'boolean') {
    if (typeof value !== 'boolean') {
      return {
        success: false,
        message: `${spec.key} must be either 'true' or 'false'`,
      };
    }
    return { success: true, value };
  }

  // Auto-validate number types
  if (spec.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return {
        success: false,
        message: `${spec.key} must be a number`,
      };
    }
    return { success: true, value };
  }

  return { success: true, value };
}

export function parseSetting(key: string, raw: string): unknown {
  const resolved = resolveAlias(key);
  const spec = getSettingSpec(resolved);

  // If spec has a custom parser, use it
  if (spec?.parse) {
    return spec.parse(raw);
  }

  // Only apply type coercion when spec explicitly indicates the type
  // This prevents converting enum/string values like "true" to boolean true
  if (spec?.type === 'number') {
    const num = Number(raw);
    if (!Number.isNaN(num)) {
      return num;
    }
  }

  if (spec?.type === 'boolean') {
    if (raw.toLowerCase() === 'true') {
      return true;
    }
    if (raw.toLowerCase() === 'false') {
      return false;
    }
  }

  // For unknown settings (no spec) or string/enum types, try JSON parse or return raw
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function getProfilePersistableKeys(): string[] {
  return SETTINGS_REGISTRY.filter((s) => s.persistToProfile).map((s) => s.key);
}

export function getSettingHelp(): Record<string, string> {
  const help: Record<string, string> = {};
  for (const spec of SETTINGS_REGISTRY) {
    help[spec.key] = spec.description;
  }
  return help;
}

export function getCompletionOptions(): ReadonlyArray<{
  key: string;
  options?: ReadonlyArray<{ value: string; description?: string }>;
}> {
  return SETTINGS_REGISTRY.filter(
    (s) => s.completionOptions || s.enumValues,
  ).map((s) => ({
    key: s.key,
    options: s.completionOptions ?? s.enumValues?.map((v) => ({ value: v })),
  }));
}

export function getAllSettingKeys(): string[] {
  return SETTINGS_REGISTRY.map((s) => s.key);
}

export function getValidationHelp(key: string): string | undefined {
  const resolved = resolveAlias(key);
  const spec = getSettingSpec(resolved);
  if (!spec) {
    return undefined;
  }

  let help = spec.description;

  if (spec.hint) {
    help += ` (${spec.hint})`;
  }

  if (spec.enumValues) {
    help += ` Valid values: ${spec.enumValues.join(', ')}`;
  }

  return help;
}

export function getAutocompleteSuggestions(
  key: string,
): ReadonlyArray<{ value: string; description?: string }> | undefined {
  const resolved = resolveAlias(key);
  const spec = getSettingSpec(resolved);
  if (!spec) {
    return undefined;
  }

  if (spec.completionOptions) {
    return spec.completionOptions;
  }

  if (spec.enumValues) {
    return spec.enumValues.map((v) => ({ value: v }));
  }

  return undefined;
}

function collectProviderConfigKeys(): string[] {
  const keys: string[] = [];
  for (const spec of SETTINGS_REGISTRY) {
    if (spec.category === 'provider-config') {
      keys.push(spec.key);
      if (spec.aliases) {
        keys.push(...spec.aliases);
      }
    }
  }
  return keys;
}

export function getProtectedSettingKeys(): string[] {
  const keys = collectProviderConfigKeys();
  keys.push('provider', 'currentProfile');
  return keys;
}

export function getProviderConfigKeys(): string[] {
  return collectProviderConfigKeys();
}

export interface DirectSettingSpec {
  value: string;
  hint: string;
  description?: string;
  options?: ReadonlyArray<{ value: string; description?: string }>;
}

function deriveHintFromSpec(spec: SettingSpec): string {
  if (spec.hint) {
    return spec.hint;
  }

  if (spec.type === 'boolean') {
    return 'true or false';
  }

  if (spec.type === 'number') {
    return 'number';
  }

  if (spec.type === 'enum' && spec.enumValues) {
    return spec.enumValues.join(', ');
  }

  if (spec.type === 'json') {
    return 'JSON object';
  }

  if (spec.type === 'string-array') {
    return 'comma-separated list';
  }

  return 'value';
}

export function getDirectSettingSpecs(): DirectSettingSpec[] {
  const specs: DirectSettingSpec[] = [];

  for (const spec of SETTINGS_REGISTRY) {
    if (
      spec.category === 'model-param' ||
      spec.category === 'custom-header' ||
      spec.category === 'provider-config'
    ) {
      continue;
    }

    const hint = deriveHintFromSpec(spec);
    const options =
      spec.completionOptions ??
      spec.enumValues?.map((v) => ({ value: v })) ??
      (spec.type === 'boolean'
        ? [{ value: 'true' }, { value: 'false' }]
        : undefined);

    specs.push({
      value: spec.key,
      hint,
      description: spec.description,
      options,
    });
  }

  return specs;
}
