/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { Config } from '@vybestack/llxprt-code-core';
import { createUiSessionOwner } from '../../__tests__/uiSessionOwner.js';
import {
  render,
  wrapWithProviders,
  createMockSettings,
} from '../../__tests__/render.js';
import { buildUiRuntimeFromSource } from '../../__tests__/ui-runtime-composition-fixture.js';
import { buildLayoutRuntimeForTest } from '../../__tests__/slash-command-runtime-fixture.js';
import { StreamingState } from '../types.js';
import { StreamingContext } from '../contexts/StreamingContext.js';

void vi.mock('../components/Composer.js', () => ({ Composer: () => null }));
const { ComposerRegion } = await import('./DefaultAppLayoutRegions.js');

describe('layout display inputs', () => {
  it('uses current accessibility display inputs rather than a conflicting runtime graph', async () => {
    const config = new Config({
      sessionId: 'layout-display',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      model: 'test',
      debugMode: false,
    });
    const owner = await createUiSessionOwner(config);
    const uiRuntime = buildUiRuntimeFromSource(config, owner);
    const layoutRuntime = buildLayoutRuntimeForTest(config, owner);
    const settings = createMockSettings({ ui: { hideContextSummary: true } });
    const tree = (disabled: boolean) =>
      wrapWithProviders(
        <StreamingContext.Provider value={StreamingState.Responding}>
          <ComposerRegion
            subscribeContextRange={() => () => {}}
            readIdeMode={owner.ide.getIdeMode.bind(owner.ide)}
            readIdeDiffingEnabled={() =>
              owner.ide.readConnection().diffingEnabled
            }
            subscribeIdeDiffing={(listener) =>
              owner.ide.subscribeConnection(() => listener())
            }
            resolveIdeDiff={owner.ide.resolveDiff.bind(owner.ide)}
            readIdeWorkspaceTrust={owner.ide.readWorkspaceTrust.bind(owner.ide)}
            subscribeIdeWorkspaceTrust={owner.ide.subscribeWorkspaceTrust.bind(
              owner.ide,
            )}
            {...{ uiRuntime }}
            screenReaderEnabled={false}
            disableLoadingPhrases={disabled}
            debugMode={false}
            layoutRuntime={layoutRuntime}
            settings={settings}
            startupWarnings={[]}
            version="test"
            nightly={false}
            mainControlsRef={{ current: null }}
            rootUiRef={{ current: null }}
            pendingHistoryItemRef={{ current: null }}
            contextFileNames={[]}
            updateInfo={null}
          />
        </StreamingContext.Provider>,
        {
          settings,
          turn: {
            streamingState: StreamingState.Responding,
            thought: {
              subject: 'captured thought',
              description: 'private details',
            },
            currentLoadingPhrase: 'working phrase',
          },
        },
      );
    const view = render(tree(true));
    try {
      expect(view.lastFrame()).not.toContain('captured thought');
      await act(async () => {
        view.rerender(tree(false));
      });
      expect(view.lastFrame()).toContain('captured thought');
    } finally {
      view.unmount();
      await config.dispose();
    }
  });
});
