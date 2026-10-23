/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  allowEditorTypeInSandbox,
  checkHasEditorType,
  type EditorType,
} from '@vybestack/llxprt-code-core';

export interface EditorDisplay {
  name: string;
  type: EditorType | 'not_set';
  disabled: boolean;
}

export const EDITOR_DISPLAY_NAMES: Record<EditorType, string> = {
  antigravity: 'Antigravity',
  zed: 'Zed',
  vscode: 'VS Code',
  vscodium: 'VSCodium',
  windsurf: 'Windsurf',
  cursor: 'Cursor',
  vim: 'Vim',
  emacs: 'Emacs',
  neovim: 'Neovim',
  hx: 'Helix',
};

export interface EditorProbes {
  hasEditor(type: EditorType): boolean;
  isAllowedInSandbox(type: EditorType): boolean;
}

const EDITOR_TYPES: readonly EditorType[] = [
  'antigravity',
  'zed',
  'vscode',
  'vscodium',
  'windsurf',
  'cursor',
  'vim',
  'emacs',
  'neovim',
  'hx',
];

/**
 * Lists the editors the settings dialog offers. Telling whether an editor is
 * installed runs a synchronous `where.exe`/`command -v` shell for every
 * candidate command, so the list is built the first time the dialog asks for
 * it. Building it when this module loads put all of those spawns into every
 * launch, including noninteractive ones that never open the dialog.
 */
export class EditorSettingsManager {
  private availableEditors: EditorDisplay[] | undefined;

  constructor(
    private readonly probes: EditorProbes = {
      hasEditor: checkHasEditorType,
      isAllowedInSandbox: allowEditorTypeInSandbox,
    },
  ) {}

  getAvailableEditorDisplays(): EditorDisplay[] {
    this.availableEditors ??= [
      {
        name: 'None',
        type: 'not_set',
        disabled: false,
      },
      ...EDITOR_TYPES.map((type) => this.describeEditor(type)),
    ];
    return this.availableEditors;
  }

  private describeEditor(type: EditorType): EditorDisplay {
    const hasEditor = this.probes.hasEditor(type);
    const isAllowedInSandbox = this.probes.isAllowedInSandbox(type);

    let labelSuffix = !isAllowedInSandbox ? ' (Not available in sandbox)' : '';
    labelSuffix = !hasEditor ? ' (Not installed)' : labelSuffix;

    return {
      name: EDITOR_DISPLAY_NAMES[type] + labelSuffix,
      type,
      disabled: !hasEditor || !isAllowedInSandbox,
    };
  }
}

export const editorSettingsManager = new EditorSettingsManager();
