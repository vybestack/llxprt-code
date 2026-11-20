/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import React, { act, useEffect } from 'react';
import { describe, expect, it } from 'bun:test';
import { render } from 'ink-testing-library';
import { Box, Static, Text } from 'ink';
import { QuitBoundary } from './quit-boundary.js';
import { Colors } from '../colors.js';

describe('quit boundary', () => {
  it('hides the transcript without disposing its terminal nodes before Ink exits', async () => {
    let disposed = 0;
    function Transcript(): React.JSX.Element {
      useEffect(
        () => () => {
          disposed++;
        },
        [],
      );
      return (
        <Box flexDirection="column">
          <Static items={['recorded']}>
            {(item) => (
              <Box key={item} borderStyle="round">
                <Text color={Colors.Foreground}>{item}</Text>
              </Box>
            )}
          </Static>
          <Text color={Colors.Foreground}>conversation</Text>
        </Box>
      );
    }
    const view = (quitting: boolean): React.JSX.Element => (
      <QuitBoundary
        quitting={quitting}
        quitDisplay={<Text color={Colors.Foreground}>Goodbye</Text>}
      >
        <Transcript />
      </QuitBoundary>
    );
    const app = render(view(false));
    try {
      await act(async () => {
        await Bun.sleep(20);
      });
      expect(app.lastFrame()).toContain('conversation');
      await act(async () => {
        app.rerender(view(true));
        await Bun.sleep(20);
      });
      expect(app.lastFrame()).toContain('Goodbye');
      expect(app.lastFrame()).not.toContain('conversation');
      expect(disposed).toBe(0);
    } finally {
      app.unmount();
    }
    expect(disposed).toBe(1);
  });
});
