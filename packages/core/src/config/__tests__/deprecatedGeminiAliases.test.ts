/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  GEMINI_DIR,
  LLXPRT_CONFIG_DIR,
  type GeminiCLIExtension,
  type LlxprtExtension,
} from '../../index.js';

describe('deprecated Gemini aliases', () => {
  it('GEMINI_DIR is the same value as LLXPRT_CONFIG_DIR', () => {
    expect(GEMINI_DIR).toBe(LLXPRT_CONFIG_DIR);
    expect(GEMINI_DIR).toBe('.llxprt');
  });

  it('GeminiCLIExtension is assignable to LlxprtExtension', () => {
    const extension: GeminiCLIExtension = {
      name: 'test',
      version: '1.0.0',
      isActive: true,
      path: '/test',
      contextFiles: [],
    };
    const renamed: LlxprtExtension = extension;
    expect(renamed.name).toBe('test');
  });

  it('LlxprtExtension is assignable to GeminiCLIExtension', () => {
    const extension: LlxprtExtension = {
      name: 'test',
      version: '1.0.0',
      isActive: true,
      path: '/test',
      contextFiles: [],
    };
    const legacy: GeminiCLIExtension = extension;
    expect(legacy.name).toBe('test');
  });
});
