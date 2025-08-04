/**
 * Main export for all default prompts
 * Combines core, tool, and provider-specific defaults
 */

import { CORE_DEFAULTS } from './core-defaults.js';
import { TOOL_DEFAULTS } from './tool-defaults.js';
import { PROVIDER_DEFAULTS } from './provider-defaults.js';
import { SERVICE_DEFAULTS } from './service-defaults.js';

/**
 * All default prompts combined into a single record
 * Keys are relative paths from ~/.llxprt/prompts/
 */
export const ALL_DEFAULTS: Record<string, string> = {
  ...CORE_DEFAULTS,
  ...TOOL_DEFAULTS,
  ...PROVIDER_DEFAULTS,
  ...SERVICE_DEFAULTS,
};

// Export individual collections for specific use cases
export { CORE_DEFAULTS, TOOL_DEFAULTS, PROVIDER_DEFAULTS, SERVICE_DEFAULTS };