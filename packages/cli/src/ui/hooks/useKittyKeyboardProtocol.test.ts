/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { renderHook } from '../../test-utils/render.js';
import { useKittyKeyboardProtocol } from './useKittyKeyboardProtocol.js';
import { terminalCapabilityManager } from '../utils/terminalCapabilityManager.js';

describe('useKittyKeyboardProtocol (AC5.1)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the manager enabled state at first render with checking false', () => {
    vi.spyOn(
      terminalCapabilityManager,
      'isKittyProtocolEnabled',
    ).mockReturnValue(true);

    const { result } = renderHook(() => useKittyKeyboardProtocol());

    expect(result.current).toStrictEqual({ enabled: true, checking: false });
  });

  it('reports a disabled manager at first render with checking false', () => {
    vi.spyOn(
      terminalCapabilityManager,
      'isKittyProtocolEnabled',
    ).mockReturnValue(false);

    const { result } = renderHook(() => useKittyKeyboardProtocol());

    expect(result.current).toStrictEqual({ enabled: false, checking: false });
  });

  it('keeps returning the first snapshot across re-renders when the manager state changes', () => {
    const isKittyProtocolEnabled = vi
      .spyOn(terminalCapabilityManager, 'isKittyProtocolEnabled')
      .mockReturnValue(true);

    const { result, rerender } = renderHook(() => useKittyKeyboardProtocol());

    expect(result.current).toStrictEqual({ enabled: true, checking: false });

    // Detection is startup-only: a later manager change must not reach the
    // already-snapshotted hook.
    isKittyProtocolEnabled.mockReturnValue(false);
    rerender();

    expect(result.current).toStrictEqual({ enabled: true, checking: false });
  });
});
