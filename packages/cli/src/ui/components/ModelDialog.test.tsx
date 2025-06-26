/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ModelDialog } from './ModelDialog.js';
import { Config } from '@google/gemini-cli-core';

describe('ModelDialog', () => {
  let mockConfig: Partial<Config>;
  const mockOnClose = vi.fn();
  const mockOnModelSelected = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-2.5-pro'),
    };
  });

  it('should render loading state initially', () => {
    const { lastFrame } = render(
      <ModelDialog
        config={mockConfig as Config}
        onClose={mockOnClose}
        onModelSelected={mockOnModelSelected}
      />
    );

    expect(lastFrame()).toContain('Loading available models...');
  });

  it('should render model selection after loading', async () => {
    const { lastFrame } = render(
      <ModelDialog
        config={mockConfig as Config}
        onClose={mockOnClose}
        onModelSelected={mockOnModelSelected}
      />
    );

    // Wait for loading to complete
    await new Promise(resolve => setTimeout(resolve, 150));

    const frame = lastFrame();
    expect(frame).toContain('Select Model');
    expect(frame).toContain('Gemini 2.5 Pro');
    expect(frame).toContain('Gemini 2.5 Flash');
    expect(frame).toContain('● Gemini 2.5 Pro'); // Current model should be selected
  });

  it('should handle escape key to close dialog', async () => {
    const { stdin } = render(
      <ModelDialog
        config={mockConfig as Config}
        onClose={mockOnClose}
        onModelSelected={mockOnModelSelected}
      />
    );

    // Wait for loading to complete
    await new Promise(resolve => setTimeout(resolve, 150));

    stdin.write('\x1B'); // Escape key

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('should handle model selection', async () => {
    const { stdin } = render(
      <ModelDialog
        config={mockConfig as Config}
        onClose={mockOnClose}
        onModelSelected={mockOnModelSelected}
      />
    );

    // Wait for loading to complete
    await new Promise(resolve => setTimeout(resolve, 150));

    // Select the current model (no navigation needed since it's already selected)
    stdin.write('\r'); // Enter

    expect(mockOnModelSelected).toHaveBeenCalledWith('gemini-2.5-pro');
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('should navigate and select different model', async () => {
    const { stdin } = render(
      <ModelDialog
        config={mockConfig as Config}
        onClose={mockOnClose}
        onModelSelected={mockOnModelSelected}
      />
    );

    // Wait for loading to complete
    await new Promise(resolve => setTimeout(resolve, 150));

    // Navigate down to flash model
    stdin.write('\u001b[B'); // Arrow down (using full escape sequence)
    
    // Small delay for navigation
    await new Promise(resolve => setTimeout(resolve, 50));
    
    stdin.write('\r'); // Enter

    expect(mockOnModelSelected).toHaveBeenCalledWith('gemini-2.5-flash');
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('should highlight current model', async () => {
    mockConfig.getModel = vi.fn().mockReturnValue('gemini-2.5-flash');
    
    const { lastFrame } = render(
      <ModelDialog
        config={mockConfig as Config}
        onClose={mockOnClose}
        onModelSelected={mockOnModelSelected}
      />
    );

    // Wait for loading to complete
    await new Promise(resolve => setTimeout(resolve, 150));

    const frame = lastFrame();
    expect(frame).toContain('● Gemini 2.5 Flash'); // Flash should be selected
  });

  it('should handle null config gracefully', async () => {
    const { lastFrame } = render(
      <ModelDialog
        config={null}
        onClose={mockOnClose}
        onModelSelected={mockOnModelSelected}
      />
    );

    // Wait for loading to complete
    await new Promise(resolve => setTimeout(resolve, 150));

    const frame = lastFrame();
    expect(frame).toContain('Select Model');
    expect(frame).toContain('Gemini 2.5 Pro');
    expect(frame).toContain('● Gemini 2.5 Pro'); // Should default to first model
  });
});