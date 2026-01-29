/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '../../../test-utils/render.js';
import { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LayoutManager, useLayout } from '../LayoutManager.js';

// Mock the useTerminalSize hook
vi.mock('../../hooks/useTerminalSize.js', () => ({
  useTerminalSize: vi.fn(() => ({ rows: 24, columns: 80 })),
}));

// Component to test the context values
const TestComponent = () => {
  const layout = useLayout();
  return (
    <>
      <div>terminalHeight: {layout.terminalHeight}</div>
      <div>terminalWidth: {layout.terminalWidth}</div>
      <div>footerHeight: {layout.footerHeight}</div>
      <div>constrainHeight: {String(layout.constrainHeight)}</div>
      <div>availableTerminalHeight: {layout.availableTerminalHeight}</div>
    </>
  );
};

describe('LayoutManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('provides initial layout values', () => {
    const { lastFrame } = render(
      <LayoutManager>
        <TestComponent />
      </LayoutManager>,
    );

    const output = lastFrame();
    expect(output).toContain('terminalHeight: 24');
    expect(output).toContain('terminalWidth: 80');
    expect(output).toContain('footerHeight: 0');
    expect(output).toContain('constrainHeight: true');
    // availableTerminalHeight = terminalHeight (24) - footerHeight (0) - staticExtraHeight (3) = 21
    expect(output).toContain('availableTerminalHeight: 21');
  });

  it('updates available terminal height when footer height changes', () => {
    let setFooterHeight: ((height: number) => void) | null = null;

    const TestWithSetter = () => {
      const layout = useLayout();
      setFooterHeight = layout.setFooterHeight;
      return <TestComponent />;
    };

    const { lastFrame } = render(
      <LayoutManager>
        <TestWithSetter />
      </LayoutManager>,
    );

    // Initial state
    expect(lastFrame()).toContain('availableTerminalHeight: 21');

    // Update footer height
    act(() => {
      setFooterHeight?.(5);
    });

    expect(lastFrame()).toContain('footerHeight: 5');
    // availableTerminalHeight = terminalHeight (24) - footerHeight (5) - staticExtraHeight (3) = 16
    expect(lastFrame()).toContain('availableTerminalHeight: 16');
  });

  it('updates constrain height when setter is called', () => {
    let setConstrainHeight: ((value: boolean) => void) | null = null;

    const TestWithSetter = () => {
      const layout = useLayout();
      setConstrainHeight = layout.setConstrainHeight;
      return <TestComponent />;
    };

    const { lastFrame } = render(
      <LayoutManager>
        <TestWithSetter />
      </LayoutManager>,
    );

    // Initial state
    expect(lastFrame()).toContain('constrainHeight: true');

    // Update constrain height
    act(() => {
      setConstrainHeight?.(false);
    });

    expect(lastFrame()).toContain('constrainHeight: false');
  });

  it('responds to terminal size changes', async () => {
    const { useTerminalSize } = await import('../../hooks/useTerminalSize.js');
    const mockUseTerminalSize = useTerminalSize as unknown as ReturnType<
      typeof vi.fn
    >;

    // Start with initial size
    mockUseTerminalSize.mockReturnValue({ rows: 24, columns: 80 });

    const { lastFrame, rerender } = render(
      <LayoutManager>
        <TestComponent />
      </LayoutManager>,
    );

    expect(lastFrame()).toContain('terminalHeight: 24');
    expect(lastFrame()).toContain('terminalWidth: 80');

    // Simulate terminal resize
    mockUseTerminalSize.mockReturnValue({ rows: 30, columns: 100 });

    rerender(
      <LayoutManager>
        <TestComponent />
      </LayoutManager>,
    );

    expect(lastFrame()).toContain('terminalHeight: 30');
    expect(lastFrame()).toContain('terminalWidth: 100');
    // availableTerminalHeight should update: 30 - 0 - 3 = 27
    expect(lastFrame()).toContain('availableTerminalHeight: 27');
  });

  it('throws error when useLayout is called outside of LayoutManager', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useLayout must be used within LayoutManager');

    consoleSpy.mockRestore();
  });
});
