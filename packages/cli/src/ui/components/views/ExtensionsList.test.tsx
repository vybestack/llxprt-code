/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { vi, describe, beforeEach, it, expect } from 'bun:test';
import { ExtensionUpdateState } from '../../state/extensions.js';
import { ExtensionsList } from './ExtensionsList.js';
import { AppCommandsProvider } from '../../contexts/AppCommandsContext.js';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';

/**
 * ExtensionsList reads only `commandContext.ui.extensionsUpdateState` from
 * the AppCommands context; the provider stub supplies exactly that slice.
 */
function renderExtensionsList(
  extensions: readonly LlxprtExtension[],
  extensionsUpdateState: Map<string, ExtensionUpdateState>,
) {
  return render(
    <AppCommandsProvider
      value={{ commandContext: { ui: { extensionsUpdateState } } } as never}
    >
      <ExtensionsList extensions={extensions} />
    </AppCommandsProvider>,
  );
}

const mockExtensions = [
  {
    name: 'ext-one',
    version: '1.0.0',
    isActive: true,
    path: '/path/to/ext-one',
    contextFiles: [],
    id: '',
  },
  {
    name: 'ext-two',
    version: '2.1.0',
    isActive: true,
    path: '/path/to/ext-two',
    contextFiles: [],
    id: '',
  },
  {
    name: 'ext-disabled',
    version: '3.0.0',
    isActive: false,
    path: '/path/to/ext-disabled',
    contextFiles: [],
    id: '',
  },
];

describe('<ExtensionsList />', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should render "No extensions installed." if there are no extensions', () => {
    const { lastFrame } = renderExtensionsList([], new Map());
    expect(lastFrame()).toContain('No extensions installed.');
  });

  it('should render a list of extensions with their version and status', () => {
    const { lastFrame } = renderExtensionsList(mockExtensions, new Map());
    const output = lastFrame();
    expect(output).toContain('ext-one (v1.0.0) - active');
    expect(output).toContain('ext-two (v2.1.0) - active');
    expect(output).toContain('ext-disabled (v3.0.0) - disabled');
  });

  it('should display "unknown state" if an extension has no update state', () => {
    const { lastFrame } = renderExtensionsList([mockExtensions[0]], new Map());
    expect(lastFrame()).toContain('(unknown state)');
  });

  const stateTestCases = [
    {
      state: ExtensionUpdateState.CHECKING_FOR_UPDATES,
      expectedText: '(checking for updates)',
    },
    {
      state: ExtensionUpdateState.UPDATING,
      expectedText: '(updating)',
    },
    {
      state: ExtensionUpdateState.UPDATE_AVAILABLE,
      expectedText: '(update available)',
    },
    {
      state: ExtensionUpdateState.UPDATED_NEEDS_RESTART,
      expectedText: '(updated, needs restart)',
    },
    {
      state: ExtensionUpdateState.UPDATED,
      expectedText: '(updated)',
    },
    {
      state: ExtensionUpdateState.ERROR,
      expectedText: '(error)',
    },
    {
      state: ExtensionUpdateState.NOT_UPDATABLE,
      expectedText: '(not updatable)',
    },
    {
      state: ExtensionUpdateState.UP_TO_DATE,
      expectedText: '(up to date)',
    },
  ];

  for (const { state, expectedText } of stateTestCases) {
    it(`should correctly display the state: ${state}`, () => {
      const updateState = new Map([[mockExtensions[0].name, state]]);
      const { lastFrame } = renderExtensionsList(
        [mockExtensions[0]],
        updateState,
      );
      expect(lastFrame()).toContain(expectedText);
    });
  }
});
