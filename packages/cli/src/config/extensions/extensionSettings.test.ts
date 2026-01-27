import { describe, it, expect } from 'vitest';
import {
  ExtensionSettingSchema,
  ExtensionSettingsArraySchema,
  ExtensionSetting,
} from './extensionSettings.js';

describe('ExtensionSettingSchema', () => {
  describe('valid settings', () => {
    it('should validate a minimal setting definition', () => {
      const setting = { name: 'apiKey', envVar: 'MY_API_KEY' };
      const result = ExtensionSettingSchema.parse(setting);
      expect(result.name).toBe('apiKey');
      expect(result.envVar).toBe('MY_API_KEY');
    });

    it('should validate a complete setting definition', () => {
      const setting = {
        name: 'apiKey',
        description: 'Your API key',
        envVar: 'MY_API_KEY',
        sensitive: true,
      };
      const result = ExtensionSettingSchema.parse(setting);
      expect(result.name).toBe('apiKey');
      expect(result.description).toBe('Your API key');
      expect(result.envVar).toBe('MY_API_KEY');
      expect(result.sensitive).toBe(true);
    });

    it('should default sensitive to false', () => {
      const setting = { name: 'apiUrl', envVar: 'API_URL' };
      const result = ExtensionSettingSchema.parse(setting);
      expect(result.sensitive).toBe(false);
    });
  });

  describe('validation errors', () => {
    it('should reject setting without name', () => {
      expect(() => ExtensionSettingSchema.parse({ envVar: 'X' })).toThrow();
    });

    it('should reject setting without envVar', () => {
      expect(() => ExtensionSettingSchema.parse({ name: 'x' })).toThrow();
    });

    it('should reject empty name', () => {
      expect(() =>
        ExtensionSettingSchema.parse({ name: '', envVar: 'X' }),
      ).toThrow();
    });

    it('should reject empty envVar', () => {
      expect(() =>
        ExtensionSettingSchema.parse({ name: 'x', envVar: '' }),
      ).toThrow();
    });

    it('should reject wrong type for name', () => {
      expect(() =>
        ExtensionSettingSchema.parse({ name: 123, envVar: 'X' }),
      ).toThrow();
    });

    it('should reject wrong type for sensitive', () => {
      expect(() =>
        ExtensionSettingSchema.parse({
          name: 'x',
          envVar: 'X',
          sensitive: 'yes',
        }),
      ).toThrow();
    });
  });

  describe('extra properties', () => {
    it('should strip unknown properties', () => {
      const setting = { name: 'x', envVar: 'X', unknownProp: 'value' };
      const result = ExtensionSettingSchema.parse(setting);
      expect('unknownProp' in result).toBe(false);
    });
  });
});

describe('ExtensionSettingsArraySchema', () => {
  it('should validate empty array', () => {
    const result = ExtensionSettingsArraySchema.parse([]);
    expect(result).toEqual([]);
  });

  it('should validate array of settings', () => {
    const settings = [
      { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
      { name: 'apiUrl', envVar: 'API_URL' },
    ];
    const result = ExtensionSettingsArraySchema.parse(settings);
    expect(result).toHaveLength(2);
    expect(result[0].sensitive).toBe(true);
    expect(result[1].sensitive).toBe(false);
  });

  it('should reject invalid setting in array', () => {
    const settings = [
      { name: 'valid', envVar: 'VALID' },
      { name: 'invalid' }, // missing envVar
    ];
    expect(() => ExtensionSettingsArraySchema.parse(settings)).toThrow();
  });
});

describe('Type inference', () => {
  it('should allow ExtensionSetting type to be used correctly', () => {
    // This is a compile-time check - if types are wrong, TypeScript will fail
    const setting: ExtensionSetting = {
      name: 'test',
      envVar: 'TEST',
      sensitive: false,
    };
    expect(setting.name).toBe('test');
  });
});
