/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from 'ink-testing-library';
import { vi } from 'vitest';
import { useTerminalSize } from '../ui/hooks/useTerminalSize.js';

type RenderResult = ReturnType<typeof render>;

export interface ResponsiveAssertions {
  narrow?: (result: RenderResult) => void;
  standard?: (result: RenderResult) => void;
  wide?: (result: RenderResult) => void;
}

export function renderAtWidth(
  component: React.ReactElement,
  width: number,
): RenderResult {
  // Mock the useTerminalSize hook to return the specified width
  const mockUseTerminalSize = vi.mocked(useTerminalSize);
  mockUseTerminalSize.mockReturnValue({ columns: width, rows: 20 });

  return render(component);
}

export function testResponsiveBehavior(
  name: string,
  component: React.ReactElement,
  assertions: ResponsiveAssertions,
): void {
  // Test narrow behavior if assertion is provided
  if (assertions.narrow) {
    const narrowResult = renderAtWidth(component, 60);
    assertions.narrow(narrowResult);
    narrowResult.unmount();
  }

  // Test standard behavior if assertion is provided
  if (assertions.standard) {
    const standardResult = renderAtWidth(component, 100);
    assertions.standard(standardResult);
    standardResult.unmount();
  }

  // Test wide behavior if assertion is provided
  if (assertions.wide) {
    const wideResult = renderAtWidth(component, 180);
    assertions.wide(wideResult);
    wideResult.unmount();
  }
}
