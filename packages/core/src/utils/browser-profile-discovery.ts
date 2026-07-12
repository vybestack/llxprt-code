/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BrowserKind } from './secure-browser-launcher.js';

/**
 * A discovered browser profile.
 */
export interface DiscoveredBrowserProfile {
  directoryName: string;
  displayName: string;
}

/**
 * Options for profile discovery. All filesystem access is injectable
 * so tests never touch real disk.
 */
export interface DiscoverBrowserProfilesOptions {
  platform?: NodeJS.Platform;
  userDataDir?: string;
  homeDir?: string;
  fileExists?: (p: string) => boolean;
  readFile?: (p: string) => string;
}

interface ChromeLocalState {
  profile?: {
    info_cache?: Record<
      string,
      { name?: string; gaia_name?: string } | undefined
    >;
  };
}

/**
 * Resolve the Chrome user data directory for the given platform.
 */
function chromeUserDataDir(
  platformName: NodeJS.Platform,
  homeDir: string,
): string {
  switch (platformName) {
    case 'darwin':
      return path.join(
        homeDir,
        'Library',
        'Application Support',
        'Google',
        'Chrome',
      );
    case 'win32':
      return path.join(
        process.env.LOCALAPPDATA ?? path.join(homeDir, 'AppData', 'Local'),
        'Google',
        'Chrome',
        'User Data',
      );
    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return path.join(homeDir, '.config', 'google-chrome');
    default:
      return path.join(homeDir, '.config', 'google-chrome');
  }
}

/**
 * Resolve the Firefox profile root directory for the given platform.
 */
function firefoxProfileRoot(
  platformName: NodeJS.Platform,
  homeDir: string,
): string {
  switch (platformName) {
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'Firefox');
    case 'win32':
      return path.join(
        process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming'),
        'Mozilla',
        'Firefox',
      );
    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return path.join(homeDir, '.mozilla', 'firefox');
    default:
      return path.join(homeDir, '.mozilla', 'firefox');
  }
}

/**
 * Discover Chrome profiles by reading the Local State JSON file.
 */
function discoverChromeProfiles(
  opts: Required<
    Omit<DiscoverBrowserProfilesOptions, 'platform' | 'userDataDir' | 'homeDir'>
  > & {
    userDataDir: string;
  },
): DiscoveredBrowserProfile[] {
  const localStatePath = path.join(opts.userDataDir, 'Local State');

  if (!opts.fileExists(localStatePath)) {
    return [];
  }

  let raw: string;
  try {
    raw = opts.readFile(localStatePath);
  } catch {
    return [];
  }

  let parsed: ChromeLocalState;
  try {
    parsed = JSON.parse(raw) as ChromeLocalState;
  } catch {
    return [];
  }

  const infoCache = parsed.profile?.info_cache;
  if (!infoCache || typeof infoCache !== 'object') {
    return [];
  }

  const profiles: DiscoveredBrowserProfile[] = [];
  for (const [directoryName, info] of Object.entries(infoCache)) {
    if (!info || typeof info !== 'object') {
      continue;
    }
    const displayName = info.name ?? directoryName;
    profiles.push({ directoryName, displayName });
  }

  return profiles;
}

interface FirefoxProfileEntry {
  name?: string;
  path?: string;
}

/**
 * Parse a Firefox profiles.ini file into profile entries.
 *
 * Each `[Profile*]` section contributes an entry built from its `Name=` and
 * `Path=` keys. Sections that yield neither a name nor a path are skipped.
 */
function parseFirefoxProfilesIni(iniContent: string): FirefoxProfileEntry[] {
  const entries: FirefoxProfileEntry[] = [];

  const sections = splitIniSections(iniContent);
  for (const section of sections) {
    if (!/^Profile\d+$/i.test(section.header)) {
      continue;
    }
    const entry = buildFirefoxEntry(section.lines);
    if (entry.name || entry.path) {
      entries.push(entry);
    }
  }

  return entries;
}

interface IniSection {
  header: string;
  lines: string[];
}

/**
 * Group raw ini lines into sections keyed by their `[header]`.
 * Lines before the first header are dropped.
 */
function splitIniSections(iniContent: string): IniSection[] {
  const sections: IniSection[] = [];
  let current: IniSection | null = null;

  for (const line of iniContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      current = { header: trimmed.slice(1, -1), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(trimmed);
    }
  }

  return sections;
}

/**
 * Build a Firefox profile entry from a section's key=value lines.
 */
function buildFirefoxEntry(lines: string[]): FirefoxProfileEntry {
  const entry: FirefoxProfileEntry = {};
  for (const trimmed of lines) {
    const parsed = parseIniKeyValue(trimmed);
    if (!parsed) {
      continue;
    }
    if (parsed.key === 'Name') {
      entry.name = parsed.value;
    } else if (parsed.key === 'Path') {
      entry.path = parsed.value;
    }
  }
  return entry;
}

function parseIniKeyValue(
  line: string,
): { key: string; value: string } | undefined {
  const eqIndex = line.indexOf('=');
  if (eqIndex === -1) {
    return undefined;
  }
  return {
    key: line.slice(0, eqIndex).trim(),
    value: line.slice(eqIndex + 1).trim(),
  };
}

/**
 * Discover Firefox profiles by reading profiles.ini.
 */
function discoverFirefoxProfiles(
  rootDir: string,
  opts: Required<
    Omit<DiscoverBrowserProfilesOptions, 'platform' | 'userDataDir' | 'homeDir'>
  >,
): DiscoveredBrowserProfile[] {
  const iniPath = path.join(rootDir, 'profiles.ini');

  if (!opts.fileExists(iniPath)) {
    return [];
  }

  let raw: string;
  try {
    raw = opts.readFile(iniPath);
  } catch {
    return [];
  }

  const entries = parseFirefoxProfilesIni(raw);

  const profiles: DiscoveredBrowserProfile[] = [];
  for (const entry of entries) {
    if (entry.path) {
      profiles.push({
        directoryName: entry.path,
        displayName: entry.name ?? entry.path,
      });
    }
  }

  return profiles;
}

/**
 * Discover browser profiles for the specified browser kind.
 *
 * All filesystem access is injectable via opts so tests never touch real disk.
 * When opts are omitted, real node:fs and os.homedir() and process.platform
 * are used.
 *
 * @param browser The browser kind to discover profiles for
 * @param opts Optional injectable filesystem and platform overrides
 * @returns Array of discovered profiles (empty if none found or errors occur)
 */
export function discoverBrowserProfiles(
  browser: BrowserKind,
  opts?: DiscoverBrowserProfilesOptions,
): DiscoveredBrowserProfile[] {
  const platformName = opts?.platform ?? process.platform;
  const homeDir = opts?.homeDir ?? os.homedir();
  const fileExists = opts?.fileExists ?? existsSync;
  const readFile = opts?.readFile ?? ((p: string) => readFileSync(p, 'utf-8'));

  const fsOpts = { fileExists, readFile };

  switch (browser) {
    case 'chrome': {
      const userDataDir =
        opts?.userDataDir ?? chromeUserDataDir(platformName, homeDir);
      return discoverChromeProfiles({ ...fsOpts, userDataDir });
    }

    case 'firefox': {
      const rootDir = firefoxProfileRoot(platformName, homeDir);
      return discoverFirefoxProfiles(rootDir, fsOpts);
    }

    case 'safari':
      return [{ directoryName: 'Default', displayName: 'Safari' }];

    default:
      return [];
  }
}
