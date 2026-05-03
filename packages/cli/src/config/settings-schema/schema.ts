import { CORE_SETTINGS_SCHEMA } from './schema-core.js';
import { EXTENSION_SETTINGS_SCHEMA } from './schema-extensions.js';
import { SECURITY_SETTINGS_SCHEMA } from './schema-security.js';
import { TAIL_SETTINGS_SCHEMA } from './schema-tail.js';
import { UI_SETTINGS_SCHEMA } from './schema-ui.js';

export const SETTINGS_SCHEMA = {
  ...CORE_SETTINGS_SCHEMA,
  ...UI_SETTINGS_SCHEMA,
  ...SECURITY_SETTINGS_SCHEMA,
  ...EXTENSION_SETTINGS_SCHEMA,
  ...TAIL_SETTINGS_SCHEMA,
} as const;
