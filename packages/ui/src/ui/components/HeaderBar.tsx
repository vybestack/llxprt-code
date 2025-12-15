import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import type { ThemeDefinition } from '../../features/theme';

const DEFAULT_LOGO_PATH = fileURLToPath(
  new URL('../../../llxprt.png', import.meta.url),
);
const LOGO_ASPECT_RATIO = 415 / 260;

interface HeaderBarProps {
  readonly text: string;
  readonly theme: ThemeDefinition;
}

export function HeaderBar({ text, theme }: HeaderBarProps): React.ReactNode {
  const headerHeight = 3;
  const themeLogoPath = fileURLToPath(
    new URL(`../../../logos/${theme.slug}.png`, import.meta.url),
  );
  const logoPath = existsSync(themeLogoPath)
    ? themeLogoPath
    : DEFAULT_LOGO_PATH;

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
        justifyContent: 'flex-start',
      }}
    >
      <image
        src={logoPath}
        alt="LLxprt Code"
        height={1}
        aspectRatio={LOGO_ASPECT_RATIO}
        backgroundColor={theme.colors.panel.headerBg ?? theme.colors.panel.bg}
        style={{ marginRight: 1 }}
      />
      <text
        fg={theme.colors.panel.headerFg ?? theme.colors.text.primary}
        style={{ alignSelf: 'center' }}
      >
        {text}
      </text>
    </box>
  );
}
