/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the settings schema/doc generator's `documentedDefault`
 * metadata mechanism (issue #2607 Finding 1).
 *
 * The mechanism separates a documented/schema default (advertised to users)
 * from a merge-applied runtime settings default (materialized by settingsMerge).
 * This keeps `streamFirstResponseTimeoutMs`'s runtime default `undefined`
 * (no unconfigured ephemeral) while generators advertise the public 300000.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSettingSchema,
  buildMarkdownDescription,
  resolveDocumentedDefault,
} from '../generate-settings-schema.js';
import type { SettingDefinition } from '../../packages/cli/src/config/settingsSchema.js';

function numberSetting(
  overrides: Partial<SettingDefinition> = {},
): SettingDefinition {
  return {
    type: 'number',
    label: 'Test Setting',
    category: 'Test',
    requiresRestart: false,
    default: 0,
    ...overrides,
  };
}

describe('resolveDocumentedDefault', () => {
  it('returns the runtime default when documentedDefault is absent', () => {
    const def = numberSetting({ default: 42 });
    expect(resolveDocumentedDefault(def)).toBe(42);
  });

  it('prefers documentedDefault over the runtime default', () => {
    const def = numberSetting({
      default: undefined,
      documentedDefault: 300000,
    });
    expect(resolveDocumentedDefault(def)).toBe(300000);
  });

  it('prefers documentedDefault even when default is a concrete value', () => {
    const def = numberSetting({ default: 1, documentedDefault: 99 });
    expect(resolveDocumentedDefault(def)).toBe(99);
  });

  it('returns undefined when neither default is defined', () => {
    const def = numberSetting({ default: undefined });
    expect(resolveDocumentedDefault(def)).toBeUndefined();
  });
});

describe('buildSettingSchema documentedDefault precedence', () => {
  const emptyDefs = new Map<string, unknown>();

  it('emits the documentedDefault as the JSON schema default when runtime default is undefined', () => {
    const def = numberSetting({
      default: undefined,
      documentedDefault: 300000,
    });
    const schema = buildSettingSchema(def, ['k'], emptyDefs as never);
    expect(schema.default).toBe(300000);
    expect(schema.type).toBe('number');
  });

  it('emits the runtime default when documentedDefault is absent', () => {
    const def = numberSetting({ default: 0 });
    const schema = buildSettingSchema(def, ['k'], emptyDefs as never);
    expect(schema.default).toBe(0);
  });

  it('emits documentedDefault when both are present (documented wins)', () => {
    const def = numberSetting({ default: 1, documentedDefault: 99 });
    const schema = buildSettingSchema(def, ['k'], emptyDefs as never);
    expect(schema.default).toBe(99);
  });

  it('omits the default key entirely when neither is defined', () => {
    const def = numberSetting({ default: undefined });
    const schema = buildSettingSchema(def, ['k'], emptyDefs as never);
    expect(schema.default).toBeUndefined();
    expect('default' in schema).toBe(false);
  });
});

describe('buildMarkdownDescription documentedDefault precedence', () => {
  it('renders the documentedDefault in the markdown Default line', () => {
    const def = numberSetting({
      default: undefined,
      documentedDefault: 300000,
    });
    const md = buildMarkdownDescription(def);
    expect(md).toContain('- Default: `300000`');
  });

  it('renders the runtime default when documentedDefault is absent', () => {
    const def = numberSetting({ default: 0 });
    const md = buildMarkdownDescription(def);
    expect(md).toContain('- Default: `0`');
  });

  it('omits the Default line when neither default is defined', () => {
    const def = numberSetting({ default: undefined });
    const md = buildMarkdownDescription(def);
    expect(md).not.toContain('- Default:');
  });
});
