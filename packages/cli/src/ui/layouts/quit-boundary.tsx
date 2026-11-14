/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type React from 'react';
import { Box } from 'ink';

export function QuitBoundary({
  quitting,
  quitDisplay,
  children,
}: React.PropsWithChildren<{
  readonly quitting: boolean;
  readonly quitDisplay: React.ReactNode;
}>): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {/* Ink retains its Static Yoga node until shutdown; keep that node alive. */}
      <Box
        flexDirection="column"
        height={quitting ? 0 : undefined}
        overflow={quitting ? 'hidden' : 'visible'}
      >
        {children}
      </Box>
      {quitting ? quitDisplay : null}
    </Box>
  );
}
