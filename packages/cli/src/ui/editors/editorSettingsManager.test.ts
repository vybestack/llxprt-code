/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...original,
    checkHasEditorType: vi.fn().mockReturnValue(true),
    allowEditorTypeInSandbox: vi.fn().mockReturnValue(true),
  };
});

import {
  editorSettingsManager,
  EDITOR_DISPLAY_NAMES,
} from './editorSettingsManager.js';

describe('editorSettingsManager', () => {
  it('should include every EditorType from EDITOR_DISPLAY_NAMES in available editors', () => {
    const displays = editorSettingsManager.getAvailableEditorDisplays();
    const displayTypes = new Set(displays.map((d) => d.type));

    for (const editorType of Object.keys(EDITOR_DISPLAY_NAMES)) {
      expect(displayTypes).toContain(editorType);
    }
  });

  it('should include antigravity in available editors', () => {
    const displays = editorSettingsManager.getAvailableEditorDisplays();
    const antigravityDisplay = displays.find((d) => d.type === 'antigravity');
    expect(antigravityDisplay).toBeDefined();
    expect(antigravityDisplay?.name).toContain('Antigravity');
  });
});
