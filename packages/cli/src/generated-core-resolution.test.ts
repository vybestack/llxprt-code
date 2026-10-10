/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Config, RecordingIntegration } from '@vybestack/llxprt-code-core';
import { Config as PackageConfig } from '@vybestack/llxprt-code-core/config/config.js';

describe('CLI native test Core source resolution', () => {
  it('loads the current recording implementation through the Core root', () => {
    expect(
      typeof Reflect.get(
        RecordingIntegration.prototype,
        'rememberRecordedHistory',
      ),
    ).toBe('function');
  });

  it('shares Config identity across root and package imports', () => {
    expect(Config).toBe(PackageConfig);
  });
});
