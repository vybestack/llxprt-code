import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import type { ThemeDefinition } from '../../features/theme';

const LOGO_ASPECT_RATIO = 415 / 260;

interface HeaderBarProps {
  readonly text: string;
  readonly theme: ThemeDefinition;
}

export function HeaderBar({ text, theme }: HeaderBarProps): React.ReactElement {
  const headerHeight = 3;

  // Resolve logo path relative to the package root for better compatibility
  // This works in both development and production bundle scenarios
  const PACKAGE_ROOT = import.meta.dir;

  let logoPath: string;
  try {
    // Try theme-specific logo first
    const themeLogoPath = resolve(
      PACKAGE_ROOT,
      '..',
      '..',
      'logos',
      `${theme.slug}.png`,
    );
    if (existsSync(themeLogoPath)) {
      logoPath = themeLogoPath;
    } else {
      // Fall back to default logo
      logoPath = resolve(PACKAGE_ROOT, '..', '..', 'llxprt.png');
    }
  } catch {
    // Last resort fallback - use relative path for edge cases
    logoPath = `../../../logos/${theme.slug}.png`;
  }

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
