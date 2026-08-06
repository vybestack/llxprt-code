/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { restoreEnv, setEnv } from '@vybestack/llxprt-code-test-utils';
import { vi } from 'bun:test';
import { validateAuthMethod } from './auth.js';

vi.mock('./settings.js', () => ({
  loadEnvironment: vi.fn(),
  loadSettings: vi.fn().mockReturnValue({
    merged: {},
  }),
}));

describe('validateAuthMethod', () => {
  beforeEach(() => {
    setEnv('GEMINI_API_KEY', undefined);
    setEnv('GOOGLE_CLOUD_PROJECT', undefined);
    setEnv('GOOGLE_CLOUD_LOCATION', undefined);
    setEnv('GOOGLE_API_KEY', undefined);
  });

  afterEach(() => {
    restoreEnv();
  });

  it('should return null for oauth-personal', () => {
    expect(validateAuthMethod('oauth-personal')).toBeNull();
  });

  it('should return null for cloud-shell', () => {
    expect(validateAuthMethod('cloud-shell')).toBeNull();
  });

  describe('gemini-api-key', () => {
    it('should return null if GEMINI_API_KEY is set', () => {
      setEnv('GEMINI_API_KEY', 'test-key');
      expect(validateAuthMethod('gemini-api-key')).toBeNull();
    });

    it('should return an error message if GEMINI_API_KEY is not set', () => {
      setEnv('GEMINI_API_KEY', '');
      expect(validateAuthMethod('gemini-api-key')).toBe(
        'GEMINI_API_KEY environment variable not found. Add that to your environment and try again (no reload needed if using .env)!',
      );
    });
  });

  describe('vertex-ai', () => {
    it('should return null if GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are set', () => {
      setEnv('GOOGLE_CLOUD_PROJECT', 'test-project');
      setEnv('GOOGLE_CLOUD_LOCATION', 'test-location');
      expect(validateAuthMethod('vertex-ai')).toBeNull();
    });

    it('should return null if GOOGLE_API_KEY is set', () => {
      setEnv('GOOGLE_API_KEY', 'test-api-key');
      expect(validateAuthMethod('vertex-ai')).toBeNull();
    });

    it('should return an error message if no required environment variables are set', () => {
      expect(validateAuthMethod('vertex-ai')).toBe(
        'When using Vertex AI, you must specify either:\n' +
          '• GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION environment variables.\n' +
          '• GOOGLE_API_KEY environment variable (if using express mode).\n' +
          'Update your environment and try again (no reload needed if using .env)!',
      );
    });
  });

  it('should return an error message for an invalid auth method', () => {
    expect(validateAuthMethod('invalid-method')).toBe(
      'Invalid auth method selected.',
    );
  });
});
