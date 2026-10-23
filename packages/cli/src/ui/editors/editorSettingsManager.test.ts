/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';

const original = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...original,
  checkHasEditorType: vi.fn().mockReturnValue(true),
  allowEditorTypeInSandbox: vi.fn().mockReturnValue(true),
}));

import {
  EditorSettingsManager,
  editorSettingsManager,
  EDITOR_DISPLAY_NAMES,
} from './editorSettingsManager.js';
import type { EditorType } from '@vybestack/llxprt-code-core';

describe('editorSettingsManager', () => {
  it('should include every EditorType from EDITOR_DISPLAY_NAMES in available editors', () => {
    const displays = editorSettingsManager.getAvailableEditorDisplays();
    const displayTypes = new Set(displays.map((d) => d.type));

    for (const editorType of Object.keys(
      EDITOR_DISPLAY_NAMES,
    ) as EditorType[]) {
      expect(displayTypes).toContain(editorType);
    }
  });

  it('should include antigravity in available editors', () => {
    const displays = editorSettingsManager.getAvailableEditorDisplays();
    const antigravityDisplay = displays.find((d) => d.type === 'antigravity');
    expect(antigravityDisplay).toBeDefined();
    expect(antigravityDisplay?.name).toContain('Antigravity');
  });

  describe('availability probing', () => {
    function countingProbes(installed: ReadonlySet<EditorType>): {
      readonly probed: EditorType[];
      readonly manager: EditorSettingsManager;
    } {
      const probed: EditorType[] = [];
      const manager = new EditorSettingsManager({
        hasEditor: (type) => {
          probed.push(type);
          return installed.has(type);
        },
        isAllowedInSandbox: () => true,
      });
      return { probed, manager };
    }

    it('probes nothing until the editors are first requested', () => {
      const { probed, manager } = countingProbes(new Set());

      expect(probed).toStrictEqual([]);
      manager.getAvailableEditorDisplays();
      expect(probed.sort()).toStrictEqual(
        (Object.keys(EDITOR_DISPLAY_NAMES) as EditorType[]).sort(),
      );
    });

    it('probes once and returns the same list on later requests', () => {
      const { probed, manager } = countingProbes(new Set());

      const first = manager.getAvailableEditorDisplays();
      const probesAfterFirst = probed.length;

      expect(manager.getAvailableEditorDisplays()).toBe(first);
      expect(probed).toHaveLength(probesAfterFirst);
    });

    it('marks editors that are not installed as disabled', () => {
      const { manager } = countingProbes(new Set<EditorType>(['vim']));

      const byType = new Map(
        manager.getAvailableEditorDisplays().map((d) => [d.type, d]),
      );

      expect(byType.get('vim')).toStrictEqual({
        name: 'Vim',
        type: 'vim',
        disabled: false,
      });
      expect(byType.get('emacs')).toStrictEqual({
        name: 'Emacs (Not installed)',
        type: 'emacs',
        disabled: true,
      });
    });
  });
});
