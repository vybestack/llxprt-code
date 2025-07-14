/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, act } from '@testing-library/react';
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
    <div>
      <div data-testid="terminal-height">{layout.terminalHeight}</div>
      <div data-testid="terminal-width">{layout.terminalWidth}</div>
      <div data-testid="footer-height">{layout.footerHeight}</div>
      <div data-testid="constrain-height">{String(layout.constrainHeight)}</div>
      <div data-testid="available-terminal-height">
        {layout.availableTerminalHeight}
      </div>
    </div>
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
    const { getByTestId } = render(
      <LayoutManager>
        <TestComponent />
      </LayoutManager>,
    );

    expect(getByTestId('terminal-height').textContent).toBe('24');
    expect(getByTestId('terminal-width').textContent).toBe('80');
    expect(getByTestId('footer-height').textContent).toBe('0');
    expect(getByTestId('constrain-height').textContent).toBe('true');
    // availableTerminalHeight = terminalHeight (24) - footerHeight (0) - staticExtraHeight (3) = 21
    expect(getByTestId('available-terminal-height').textContent).toBe('21');
  });

  it('updates available terminal height when footer height changes', () => {
    let setFooterHeight: ((height: number) => void) | null = null;

    const TestWithSetter = () => {
      const layout = useLayout();
      setFooterHeight = layout.setFooterHeight;
      return <TestComponent />;
    };

    const { getByTestId } = render(
      <LayoutManager>
        <TestWithSetter />
      </LayoutManager>,
    );

    // Initial state
    expect(getByTestId('available-terminal-height').textContent).toBe('21');

    // Update footer height
    act(() => {
      setFooterHeight?.(5);
    });

    expect(getByTestId('footer-height').textContent).toBe('5');
    // availableTerminalHeight = terminalHeight (24) - footerHeight (5) - staticExtraHeight (3) = 16
    expect(getByTestId('available-terminal-height').textContent).toBe('16');
  });

  it('updates constrain height when setter is called', () => {
    let setConstrainHeight: ((value: boolean) => void) | null = null;

    const TestWithSetter = () => {
      const layout = useLayout();
      setConstrainHeight = layout.setConstrainHeight;
      return <TestComponent />;
    };

    const { getByTestId } = render(
      <LayoutManager>
        <TestWithSetter />
      </LayoutManager>,
    );

    // Initial state
    expect(getByTestId('constrain-height').textContent).toBe('true');

    // Update constrain height
    act(() => {
      setConstrainHeight?.(false);
    });

    expect(getByTestId('constrain-height').textContent).toBe('false');
  });

  it('responds to terminal size changes', async () => {
    const { useTerminalSize } = await import('../../hooks/useTerminalSize.js');
    const mockUseTerminalSize = useTerminalSize as unknown as ReturnType<
      typeof vi.fn
    >;

    // Start with initial size
    mockUseTerminalSize.mockReturnValue({ rows: 24, columns: 80 });

    const { getByTestId, rerender } = render(
      <LayoutManager>
        <TestComponent />
      </LayoutManager>,
    );

    expect(getByTestId('terminal-height').textContent).toBe('24');
    expect(getByTestId('terminal-width').textContent).toBe('80');

    // Simulate terminal resize
    mockUseTerminalSize.mockReturnValue({ rows: 30, columns: 100 });

    rerender(
      <LayoutManager>
        <TestComponent />
      </LayoutManager>,
    );

    expect(getByTestId('terminal-height').textContent).toBe('30');
    expect(getByTestId('terminal-width').textContent).toBe('100');
    // availableTerminalHeight should update: 30 - 0 - 3 = 27
    expect(getByTestId('available-terminal-height').textContent).toBe('27');
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
