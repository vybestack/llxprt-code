/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { ApprovalMode, Config } from '@vybestack/llxprt-code-core';
import { LoadedSettings } from '../../config/settings.js';
import { buildSlashCommandRuntime } from '../cliUiRuntime.js';
import { StreamingState } from '../types.js';
import { StatusBarLeft, type InlineContentProps } from './InlineContent.js';

vi.mock('../components/ContextSummaryDisplay.js', () => ({
  ContextSummaryDisplay: () => null,
}));

function createProps(): InlineContentProps {
  return {
    streamingState: StreamingState.Idle,
    disableLoadingPhrases: false,
    thought: null,
    currentLoadingPhrase: undefined,
    elapsedTime: 0,
    hideContextSummary: true,
    isNarrow: false,
    ctrlCPressedOnce: false,
    ctrlDPressedOnce: false,
    showEscapePrompt: false,
    ideContextState: undefined,
    llxprtMdFileCount: 0,
    coreMemoryFileCount: 0,
    contextFileNames: [],
    config: buildSlashCommandRuntime(
      new Config({
        sessionId: 'inline-content-test',
        targetDir: '/tmp',
        cwd: '/tmp',
        debugMode: false,
        model: 'test-model',
      }),
    ),
    showToolDescriptions: false,
    showAutoAcceptIndicator: ApprovalMode.DEFAULT,
    shellModeActive: false,
    showErrorDetails: false,
    consoleMessages: [],
    constrainHeight: false,
    debugConsoleMaxHeight: 0,
    inputWidth: 80,
    isInputActive: false,
    settings: new LoadedSettings(
      { path: '/system/settings.json', settings: {} },
      { path: '/system/defaults.json', settings: {} },
      { path: '/user/settings.json', settings: {} },
      { path: '/workspace/settings.json', settings: {} },
      true,
    ),
    onSuggestionsVisibilityChange: vi.fn(),
  };
}

describe('StatusBarLeft', () => {
  it('does not create an empty wrapper when no left status is visible', () => {
    const previousSystemMd = process.env.GEMINI_SYSTEM_MD;
    delete process.env.GEMINI_SYSTEM_MD;

    try {
      expect(StatusBarLeft(createProps())).toBeNull();
    } finally {
      if (previousSystemMd === undefined) {
        delete process.env.GEMINI_SYSTEM_MD;
      } else {
        process.env.GEMINI_SYSTEM_MD = previousSystemMd;
      }
    }
  });

  it('renders a wrapper when the escape prompt is active', () => {
    const props = { ...createProps(), showEscapePrompt: true };
    expect(StatusBarLeft(props)).not.toBeNull();
  });

  it('renders a wrapper when ctrl-C has been pressed once', () => {
    const props = { ...createProps(), ctrlCPressedOnce: true };
    expect(StatusBarLeft(props)).not.toBeNull();
  });

  it('renders a wrapper when the context summary is visible', () => {
    const props = { ...createProps(), hideContextSummary: false };
    expect(StatusBarLeft(props)).not.toBeNull();
  });

  it('renders a wrapper when GEMINI_SYSTEM_MD is set', () => {
    const previousSystemMd = process.env.GEMINI_SYSTEM_MD;
    process.env.GEMINI_SYSTEM_MD = 'true';

    try {
      expect(StatusBarLeft(createProps())).not.toBeNull();
    } finally {
      if (previousSystemMd === undefined) {
        delete process.env.GEMINI_SYSTEM_MD;
      } else {
        process.env.GEMINI_SYSTEM_MD = previousSystemMd;
      }
    }
  });
});
