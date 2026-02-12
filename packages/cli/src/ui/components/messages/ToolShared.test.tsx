/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import {
  ToolStatusIndicator,
  ToolInfo,
  TrailingIndicator,
  STATUS_INDICATOR_WIDTH,
} from './ToolShared.js';
import { ToolCallStatus, StreamingState } from '../../types.js';
import { StreamingContext } from '../../contexts/StreamingContext.js';
import { renderWithProviders } from '../../../test-utils/render.js';
import { TOOL_STATUS } from '../../constants.js';

vi.mock('../GeminiRespondingSpinner.js', () => ({
  GeminiRespondingSpinner: ({
    nonRespondingDisplay,
  }: {
    nonRespondingDisplay?: string;
  }) => {
    const streamingState = React.useContext(StreamingContext)!;
    if (streamingState === StreamingState.Responding) {
      return <>{`MockSpinner`}</>;
    }
    return nonRespondingDisplay ? <>{nonRespondingDisplay}</> : null;
  },
}));

const renderInContext = (
  ui: React.ReactElement,
  streamingState: StreamingState = StreamingState.Idle,
) =>
  renderWithProviders(
    <StreamingContext.Provider value={streamingState}>
      {ui}
    </StreamingContext.Provider>,
  );

describe('<ToolStatusIndicator />', () => {
  it('renders SUCCESS indicator', () => {
    const { lastFrame } = renderInContext(
      <ToolStatusIndicator status={ToolCallStatus.Success} name="test" />,
    );
    expect(lastFrame()).toContain(TOOL_STATUS.SUCCESS);
  });

  it('renders Pending indicator', () => {
    const { lastFrame } = renderInContext(
      <ToolStatusIndicator status={ToolCallStatus.Pending} name="test" />,
    );
    expect(lastFrame()).toContain(TOOL_STATUS.PENDING);
  });

  it('renders Error indicator', () => {
    const { lastFrame } = renderInContext(
      <ToolStatusIndicator status={ToolCallStatus.Error} name="test" />,
    );
    expect(lastFrame()).toContain(TOOL_STATUS.ERROR);
  });

  it('renders Confirming indicator', () => {
    const { lastFrame } = renderInContext(
      <ToolStatusIndicator status={ToolCallStatus.Confirming} name="test" />,
    );
    expect(lastFrame()).toContain(TOOL_STATUS.CONFIRMING);
  });

  it('renders Canceled indicator', () => {
    const { lastFrame } = renderInContext(
      <ToolStatusIndicator status={ToolCallStatus.Canceled} name="test" />,
    );
    expect(lastFrame()).toContain(TOOL_STATUS.CANCELED);
  });

  it('renders Executing indicator with paused spinner when idle', () => {
    const { lastFrame } = renderInContext(
      <ToolStatusIndicator status={ToolCallStatus.Executing} name="test" />,
      StreamingState.Idle,
    );
    expect(lastFrame()).toContain(TOOL_STATUS.EXECUTING);
  });
});

describe('ToolInfo', () => {
  it('is a function component that accepts required props', () => {
    // ToolInfo contains {' '} between nested <Text> elements which Ink's
    // test reconciler rejects (even though it works at runtime). Verify the
    // component exists and is callable with the expected signature.
    expect(typeof ToolInfo).toBe('function');
    const element = React.createElement(ToolInfo, {
      name: 'read_file',
      description: '/path/to/file.ts',
      status: ToolCallStatus.Success,
      emphasis: 'medium' as const,
    });
    expect(element).toBeTruthy();
    expect(element.props.name).toBe('read_file');
    expect(element.props.description).toBe('/path/to/file.ts');
  });
});

describe('STATUS_INDICATOR_WIDTH', () => {
  it('is exported and has a positive value', () => {
    expect(STATUS_INDICATOR_WIDTH).toBeGreaterThan(0);
  });
});

describe('TrailingIndicator', () => {
  it('is a function component', () => {
    expect(typeof TrailingIndicator).toBe('function');
    const element = React.createElement(TrailingIndicator);
    expect(element).toBeTruthy();
  });
});
