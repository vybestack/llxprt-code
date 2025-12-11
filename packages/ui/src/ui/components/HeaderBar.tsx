import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { useRenderer } from '@vybestack/opentui-react';
import { useEffect, useState } from 'react';
import type { ThemeDefinition } from '../../features/theme';
import { getLogger } from '../../lib/logger';

const logger = getLogger('nui:headerbar');

// Get the directory of this source file, then navigate to the logo
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATH = path.resolve(__dirname, '../../../llxprt.png');

logger.debug('HeaderBar module loaded', {
  __filename,
  __dirname,
  LOGO_PATH,
  logoExists: existsSync(LOGO_PATH),
});
const LOGO_PX_WIDTH = 150;
const LOGO_PX_HEIGHT = 90;

interface HeaderBarProps {
  readonly text: string;
  readonly theme: ThemeDefinition;
}

export function HeaderBar({ text, theme }: HeaderBarProps): React.ReactNode {
  const renderer = useRenderer();

  const caps = renderer.capabilities as {
    pixelResolution?: { width: number; height: number };
  } | null;
  const resolution = caps?.pixelResolution ?? renderer.resolution ?? null;
  const cellMetrics = renderer.getCellMetrics() ?? null;

  // Log graphics support and resolution detection
  logger.debug('HeaderBar render', {
    graphicsSupport: renderer.graphicsSupport,
    termProgram: process.env.TERM_PROGRAM,
    term: process.env.TERM,
    resolution,
    cellMetrics,
    rendererResolution: renderer.resolution,
    terminalWidth: renderer.terminalWidth,
    terminalHeight: renderer.terminalHeight,
  });
  const [, setTick] = useState(0);

  useEffect(() => {
    const refresh = () => setTick((t) => t + 1);
    renderer.on('capabilities', refresh);
    renderer.on('pixelResolution', refresh);
    renderer.on('resize', refresh);
    return () => {
      renderer.off('capabilities', refresh);
      renderer.off('pixelResolution', refresh);
      renderer.off('resize', refresh);
    };
  }, [renderer]);

  const pxPerCellX =
    resolution && renderer.terminalWidth > 0
      ? resolution.width / renderer.terminalWidth
      : null;
  const pxPerCellY =
    resolution && renderer.terminalHeight > 0
      ? resolution.height / renderer.terminalHeight
      : null;
  const desiredCellHeight = 2;
  const scaleFactor = 0.9; // modest shrink to keep it inside the border
  const fallbackPxPerCellX = 9;
  const fallbackPxPerCellY = 20;
  const scaledPixelHeight = Math.round(
    pxPerCellY != null
      ? Math.min(
          LOGO_PX_HEIGHT * scaleFactor,
          pxPerCellY * desiredCellHeight * scaleFactor,
        )
      : LOGO_PX_HEIGHT * scaleFactor,
  );
  const scaledPixelWidth = Math.max(
    1,
    Math.round((scaledPixelHeight * LOGO_PX_WIDTH) / LOGO_PX_HEIGHT),
  );
  const effPxPerCellX = pxPerCellX ?? fallbackPxPerCellX;
  const effPxPerCellY = pxPerCellY ?? fallbackPxPerCellY;
  const logoWidthCells = Math.max(
    1,
    Math.ceil(scaledPixelWidth / effPxPerCellX),
  );
  const logoHeightCells = Math.max(
    1,
    Math.ceil(scaledPixelHeight / effPxPerCellY),
  );
  const headerHeight = Math.max(logoHeightCells + 1, 3);

  return (
    <box
      style={{
        border: true,
        height: headerHeight,
        minHeight: headerHeight,
        maxHeight: headerHeight,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
        borderColor: theme.colors.panel.border,
        backgroundColor: theme.colors.panel.headerBg ?? theme.colors.panel.bg,
        alignItems: 'center',
        flexDirection: 'row',
        gap: 0,
        justifyContent: 'flex-start',
      }}
    >
      <image
        src={LOGO_PATH}
        alt="LLxprt Code"
        width={logoWidthCells}
        height={logoHeightCells}
        pixelWidth={scaledPixelWidth}
        pixelHeight={scaledPixelHeight}
        style={{ marginRight: 1 }}
      />
      <text
        fg={theme.colors.panel.headerFg ?? theme.colors.text.primary}
        style={{ marginLeft: 1, alignSelf: 'center' }}
      >
        {text}
      </text>
    </box>
  );
}
