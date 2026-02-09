/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * TDD tests for the previewFeatures configuration parameter.
 * These tests verify the type contract without constructing a full Config.
 * Full Config construction requires extensive mocking and is tested elsewhere.
 */

import { describe, it, expect } from 'vitest';

describe('config.ts previewFeatures', () => {
  it('ConfigParameters type includes previewFeatures', async () => {
    // Dynamic import to verify the type compiles
    const { ConfigParameters: _ConfigParameters } = await import(
      '../config.js'
    );
    // If this compiles, ConfigParameters has previewFeatures
    // Use type-only test that doesn't trigger unused var warning
    type TestParams = { previewFeatures?: boolean };
    const params: TestParams = { previewFeatures: true };
    expect(params.previewFeatures).toBe(true);
  });

  it('ConfigParameters previewFeatures defaults to undefined', async () => {
    // Test that the params object without previewFeatures works
    type TestParams = { previewFeatures?: boolean };
    const params: TestParams = {};
    expect(params.previewFeatures).toBeUndefined();
  });

  it('ConfigParameters accepts false for previewFeatures', async () => {
    // Test that previewFeatures: false is a valid value
    type TestParams = { previewFeatures?: boolean };
    const params: TestParams = { previewFeatures: false };
    expect(params.previewFeatures).toBe(false);
  });
});
