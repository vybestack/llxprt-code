/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { act } from 'react';
import type { HydratedModel } from '@vybestack/llxprt-code-core';
import { createDeferred, waitFor } from '../../test-utils/async.js';
import { render } from '../../test-utils/render.js';
import { KeypressProvider } from '../contexts/KeypressContext.js';
import { ModelsDialog, type ModelsDialogProps } from './ModelDialog.js';

// The kitty/CSI-u escape keycode. A lone ESC byte only becomes a decoded
// 'escape' key after the KeypressProvider's 100ms escape timeout, so the tests
// drive the synchronous keycode form the real terminal sends instead of
// sleeping on a timer.
const ESCAPE_KEY = '\u001B[27u';

type MockRuntimeApi = {
  listProviders: () => string[];
  listAvailableModels: (providerName: string) => Promise<HydratedModel[]>;
};

// Module-scope mutable mocks. The vi.mock factory is hoisted above these
// declarations, so the factory must return a useRuntimeApi that dereferences the
// mutable holder at CALL time, never at factory-definition time. Reset in
// beforeEach so each test installs its own behavior.
const runtimeHolder: MockRuntimeApi = {
  listProviders: () => [],
  listAvailableModels: () => Promise.resolve([]),
};

// The api object is memoized so re-renders see a stable reference (matching how
// the real RuntimeContext memoizes its bridge) so useModelsData's effects do not
// re-run on every render.
let memoizedRuntimeApi: MockRuntimeApi | undefined;

void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => {
    memoizedRuntimeApi ??= {
      listProviders: () => runtimeHolder.listProviders(),
      listAvailableModels: (providerName: string) =>
        runtimeHolder.listAvailableModels(providerName),
    };
    return memoizedRuntimeApi;
  },
}));

// Pin to a wide terminal so column widths and frames are deterministic.
void vi.mock('../hooks/useTerminalSize.js', () => ({
  useTerminalSize: () => ({ columns: 140, rows: 40 }),
}));

// The dialog loads models in an async effect. Flush pending microtasks inside
// act() before polling, so the resolution-driven state update is attributed to
// the test rather than leaking a React act() warning.
async function waitForFrame(assertion: () => void): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(assertion);
}

function makeModel(
  provider: string,
  id: string,
  overrides?: Partial<HydratedModel>,
): HydratedModel {
  return { provider, id, name: id, ...overrides };
}

type OnSelectSpy = ReturnType<typeof vi.fn<ModelsDialogProps['onSelect']>>;
type OnCloseSpy = ReturnType<typeof vi.fn<ModelsDialogProps['onClose']>>;
type RenderModelsDialogResult = ReturnType<typeof render> & {
  onSelect: OnSelectSpy;
  onClose: OnCloseSpy;
};

function renderModelsDialog(
  props: Partial<ModelsDialogProps> = {},
): RenderModelsDialogResult {
  const onSelect = vi.fn<ModelsDialogProps['onSelect']>();
  const onClose = vi.fn<ModelsDialogProps['onClose']>();
  const result = render(
    <KeypressProvider>
      <ModelsDialog onSelect={onSelect} onClose={onClose} {...props} />
    </KeypressProvider>,
  );
  return { ...result, onSelect, onClose };
}

describe('ModelsDialog', () => {
  beforeEach(() => {
    runtimeHolder.listProviders = () => [];
    runtimeHolder.listAvailableModels = () => Promise.resolve([]);
    memoizedRuntimeApi = undefined;
  });

  it('shows a loading frame while models are in flight and lists them after they resolve', async () => {
    // showAllProviders: true => computedInitialFilter is null, so all providers are fetched.
    const models = [
      makeModel('alpha', 'alpha-a'),
      makeModel('alpha', 'alpha-b'),
    ];
    const deferred = createDeferred<HydratedModel[]>();
    runtimeHolder.listProviders = () => ['alpha'];
    runtimeHolder.listAvailableModels = () => deferred.promise;

    const { lastFrame } = renderModelsDialog({ showAllProviders: true });

    const loadingFrame = lastFrame() ?? '';
    expect(loadingFrame).toContain('Loading models...');
    // The results frame is entirely absent while loading: no table header, no
    // search UI, no Found count, no model ids.
    expect(loadingFrame).not.toContain('alpha-a');
    expect(loadingFrame).not.toContain('MODEL ID');
    expect(loadingFrame).not.toContain('Search:');
    expect(loadingFrame).not.toContain('Found');

    await act(async () => {
      deferred.resolve(models);
    });

    await waitForFrame(() => {
      const frame = lastFrame() ?? '';
      expect(frame).not.toContain('Loading models...');
      expect(frame).toContain('MODEL ID');
      expect(frame).toContain('Search:');
      expect(frame).toContain(`Found ${String(models.length)}`);
      expect(frame).toContain('alpha-a');
      expect(frame).toContain('alpha-b');
    });
  });

  it('shows an empty results frame when listProviders throws', async () => {
    // showAllProviders: true => providerFilter is null, so the models come from
    // listProviders; with it throwing there are zero providers and zero models.
    runtimeHolder.listProviders = () => {
      throw new Error('providers unavailable');
    };

    const { lastFrame } = renderModelsDialog({ showAllProviders: true });

    await waitForFrame(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Found 0');
      expect(frame).not.toContain('Loading models...');
    });
  });

  it('shows an empty results frame when listAvailableModels rejects for the only provider', async () => {
    // showAllProviders: true => providerFilter is null, so the only provider (alpha)
    // is fetched and its rejection yields zero models.
    runtimeHolder.listProviders = () => ['alpha'];
    runtimeHolder.listAvailableModels = () =>
      Promise.reject(new Error('model fetch failed'));

    const { lastFrame } = renderModelsDialog({ showAllProviders: true });

    await waitForFrame(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Found 0');
      expect(frame).not.toContain('Loading models...');
    });
  });

  it('does not abort the rest when the first provider rejects, listing the second resolving provider', async () => {
    // showAllProviders: true => providerFilter is null, so both alpha and beta are
    // fetched; the FIRST provider rejects and the shared fetch continues past it to
    // keep beta's models, so an implementation that only ever fetched the first
    // provider would fail on beta's ids below.
    const betaModels = [
      makeModel('beta', 'beta-a'),
      makeModel('beta', 'beta-b'),
    ];
    runtimeHolder.listProviders = () => ['alpha', 'beta'];
    runtimeHolder.listAvailableModels = (providerName: string) => {
      if (providerName === 'alpha') {
        return Promise.reject(new Error('alpha outage'));
      }
      return Promise.resolve(betaModels);
    };

    const { lastFrame } = renderModelsDialog({ showAllProviders: true });

    await waitForFrame(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('beta-a');
      expect(frame).toContain('beta-b');
      expect(frame).toContain(`Found ${String(betaModels.length)}`);
      expect(frame).not.toContain('alpha-a');
    });
  });

  it('shows Found 0 of the baseline count when the search matches nothing', async () => {
    // showAllProviders: true => providerFilter is null, so the baseline is all
    // loaded models; the search term matches none of them.
    const loadedModels = [
      makeModel('alpha', 'a-one'),
      makeModel('alpha', 'a-two'),
      makeModel('alpha', 'a-three'),
    ];
    runtimeHolder.listProviders = () => ['alpha'];
    runtimeHolder.listAvailableModels = () => Promise.resolve(loadedModels);

    const { stdin, lastFrame } = renderModelsDialog({ showAllProviders: true });

    await waitForFrame(() => {
      expect(lastFrame() ?? '').toContain(
        `Found ${String(loadedModels.length)}`,
      );
    });

    await act(async () => {
      stdin.write('zzz-no-match');
    });

    expect(lastFrame() ?? '').toContain(
      `Found 0 of ${String(loadedModels.length)}`,
    );
  });

  it('confirms the first filtered row on Enter without closing', async () => {
    // showAllProviders: true => providerFilter is null, so all loaded models are
    // candidates and the first filtered row is the alphabetically first id.
    const models = [
      makeModel('alpha', 'alpha-c'),
      makeModel('alpha', 'alpha-a'),
      makeModel('alpha', 'alpha-b'),
    ];
    runtimeHolder.listProviders = () => ['alpha'];
    runtimeHolder.listAvailableModels = () => Promise.resolve(models);

    const { stdin, lastFrame, onSelect, onClose } = renderModelsDialog({
      showAllProviders: true,
    });

    await waitForFrame(() => {
      expect(lastFrame() ?? '').toContain(`Found ${String(models.length)}`);
    });

    await act(async () => {
      stdin.write('\r');
    });

    const firstFilteredId = models.map((model) => model.id).sort()[0];
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.id).toBe(firstFilteredId);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clears the search term on Escape instead of closing', async () => {
    // showAllProviders: true => providerFilter is null, so the full baseline is all
    // loaded models; once the term is cleared the of-N suffix disappears.
    const models = [
      makeModel('alpha', 'alpha-a'),
      makeModel('alpha', 'alpha-b'),
    ];
    runtimeHolder.listProviders = () => ['alpha'];
    runtimeHolder.listAvailableModels = () => Promise.resolve(models);

    const { stdin, lastFrame, onSelect, onClose } = renderModelsDialog({
      showAllProviders: true,
    });

    await waitForFrame(() => {
      expect(lastFrame() ?? '').toContain(`Found ${String(models.length)}`);
    });

    await act(async () => {
      stdin.write('alpha-a');
    });

    expect(lastFrame() ?? '').toContain(`Found 1 of ${String(models.length)}`);

    await act(async () => {
      stdin.write(ESCAPE_KEY);
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    const clearedFrame = lastFrame() ?? '';
    expect(clearedFrame).toContain(`Found ${String(models.length)}`);
    expect(clearedFrame).not.toContain(` of ${String(models.length)}`);
  });

  it('closes on Escape when the search is empty', async () => {
    // showAllProviders: true => providerFilter is null, so the dialog filters over
    // all loaded providers while the search stays empty.
    const models = [makeModel('alpha', 'alpha-a')];
    runtimeHolder.listProviders = () => ['alpha'];
    runtimeHolder.listAvailableModels = () => Promise.resolve(models);

    const { stdin, lastFrame, onSelect, onClose } = renderModelsDialog({
      showAllProviders: true,
    });

    await waitForFrame(() => {
      expect(lastFrame() ?? '').toContain('Found 1');
    });

    await act(async () => {
      stdin.write(ESCAPE_KEY);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
