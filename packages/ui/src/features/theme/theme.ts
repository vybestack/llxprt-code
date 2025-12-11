import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLogger } from '../../lib/logger';

export type ThemeKind = 'light' | 'dark' | 'ansi' | 'custom';

export interface ThemeColors {
  readonly background: string;
  readonly panel: {
    readonly bg: string;
    readonly border: string;
    readonly headerBg?: string;
    readonly headerFg?: string;
  };
  readonly text: {
    readonly primary: string;
    readonly muted: string;
    readonly user: string;
    readonly responder: string;
    readonly thinking: string;
    readonly tool: string;
  };
  readonly input: {
    readonly bg: string;
    readonly fg: string;
    readonly placeholder: string;
    readonly border: string;
  };
  readonly status: {
    readonly fg: string;
    readonly muted?: string;
  };
  readonly accent: {
    readonly primary: string;
    readonly secondary?: string;
    readonly warning?: string;
    readonly error?: string;
    readonly success?: string;
  };
  readonly selection: {
    readonly fg: string;
    readonly bg: string;
  };
  readonly diff: {
    readonly addedBg: string;
    readonly addedFg: string;
    readonly removedBg: string;
    readonly removedFg: string;
  };
  readonly scrollbar?: {
    readonly thumb: string;
    readonly track: string;
  };
  readonly message: {
    readonly userBorder: string;
    readonly systemBorder: string;
    readonly systemText: string;
    readonly systemBg?: string;
  };
}

export interface ThemeDefinition {
  readonly name: string;
  readonly slug: string;
  readonly kind: ThemeKind;
  readonly colors: ThemeColors;
}

// Get the directory of this source file, then navigate to themes directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const THEMES_DIR = path.resolve(__dirname, '../../../themes');
export const DEFAULT_THEME_SLUG = 'green-screen';

const logger = getLogger('nui:theme');

export function loadThemes(): ThemeDefinition[] {
  try {
    const files = readdirSync(THEMES_DIR).filter((file) =>
      file.endsWith('.json'),
    );
    const themes: ThemeDefinition[] = files.map((file) => {
      const fullPath = path.join(THEMES_DIR, file);
      const raw = JSON.parse(readFileSync(fullPath, 'utf8')) as ThemeDefinition;
      return { ...raw, slug: raw.slug || path.basename(file, '.json') };
    });
    return themes;
  } catch (error) {
    logger.error('Failed to load themes:', error);
    return [];
  }
}

export function findTheme(
  themes: ThemeDefinition[],
  key: string,
): ThemeDefinition | undefined {
  const normalized = key.trim().toLowerCase();
  return themes.find(
    (theme) =>
      theme.slug.toLowerCase() === normalized ||
      theme.name.toLowerCase() === normalized,
  );
}
