/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import { stat } from 'node:fs/promises';
import { env } from 'node:process';
import { URL } from 'node:url';
import { envOr } from './env.js';
import * as nodePath from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Type for the options object passed to execFileAsync for browser launches.
 * Node's ExecFileOptions does not declare `detached` or `stdio` (they live on
 * SpawnOptions), but execFile forwards them to spawn at runtime. Declaring
 * them explicitly here keeps TypeScript checking of the known keys while
 * permitting the spawn-only fields we rely on.
 */
type BrowserExecOptions = ExecFileOptions & {
  detached?: boolean;
  stdio?: 'ignore' | 'pipe' | 'inherit';
};

/**
 * Shared exec options for browser launches. Both the default-browser path
 * and the specific-browser path use these so behavior stays consistent.
 */
function getBrowserExecOptions(): BrowserExecOptions {
  const browserEnv = { ...env };
  delete browserEnv.SHELL;
  return {
    env: browserEnv,
    detached: true,
    stdio: 'ignore',
  };
}

/**
 * Candidate Chrome/Chromium binary names on Linux/BSD, tried in order when
 * the preferred name is not installed. Different distros ship the browser
 * under different names (google-chrome, google-chrome-stable, chromium,
 * chromium-browser).
 */
const LINUX_CHROME_BINARIES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
];

/**
 * Candidate Firefox binary names on Linux/BSD (firefox, firefox-esr on
 * Debian/Ubuntu).
 */
const LINUX_FIREFOX_BINARIES = ['firefox', 'firefox-esr'];

/**
 * Typical Windows install locations for Chrome (relative to the system drive
 * root, Program Files, and LOCALAPPDATA). Probed when a bare `chrome.exe` is
 * not on PATH.
 */
const WINDOWS_CHROME_PATHS = [
  () =>
    nodePath.join(
      envOr(env.PROGRAMFILES, 'C:\\Program Files'),
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    ),
  () =>
    nodePath.join(
      envOr(env['PROGRAMFILES(X86)'], 'C:\\Program Files (x86)'),
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    ),
  () =>
    nodePath.join(
      envOr(
        env.LOCALAPPDATA,
        nodePath.join(
          envOr(env.USERPROFILE, 'C:\\Users\\Public'),
          'AppData',
          'Local',
        ),
      ),
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    ),
];

/**
 * Typical Windows install locations for Firefox, probed when a bare
 * `firefox.exe` is not on PATH.
 */
const WINDOWS_FIREFOX_PATHS = [
  () =>
    nodePath.join(
      envOr(env.PROGRAMFILES, 'C:\\Program Files'),
      'Mozilla Firefox',
      'firefox.exe',
    ),
  () =>
    nodePath.join(
      envOr(env['PROGRAMFILES(X86)'] ?? undefined, 'C:\\Program Files (x86)'),
      'Mozilla Firefox',
      'firefox.exe',
    ),
];

/**
 * Supported browser kinds for targeted launching.
 */
export type BrowserKind = 'chrome' | 'firefox' | 'safari';

/**
 * Whether the platform is Linux or a BSD variant. Centralized so the
 * default-browser path and the specific-browser fallback path agree on which
 * platforms count as "Linux-like".
 */
function isLinuxLike(platformName: NodeJS.Platform): boolean {
  return (
    platformName === 'linux' ||
    platformName === 'freebsd' ||
    platformName === 'openbsd'
  );
}

/**
 * Options for launching a specific browser binary with an optional profile.
 * Chrome accepts a profile directory name. Firefox accepts either a profile
 * name or an absolute profile path; names use `-P` and paths use `-profile`.
 */
export interface BrowserLaunchOptions {
  browser?: BrowserKind;
  profileDirectory?: string;
}

/**
 * Validates that a URL is safe to open in a browser.
 * Only allows HTTP and HTTPS URLs to prevent command injection.
 *
 * @param url The URL to validate
 * @throws Error if the URL is invalid or uses an unsafe protocol
 */
function validateUrl(url: string): void {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    // URL parsing failed - rethrow with context
    throw new Error(`Invalid URL: ${url}`);
  }

  // Only allow HTTP and HTTPS protocols
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(
      `Unsafe protocol: ${parsedUrl.protocol}. Only HTTP and HTTPS are allowed.`,
    );
  }

  // Additional validation: ensure no newlines or control characters
  for (const ch of url) {
    const code = ch.charCodeAt(0);
    if (code === 0x0d || code === 0x0a || (code >= 0x00 && code <= 0x1f)) {
      throw new Error('URL contains invalid characters');
    }
  }
}

/**
 * Characters that must never appear in a profile directory name because they
 * enable path traversal, act as path separators, or are shell/argument
 * metacharacters. Everything else (including Unicode display names with
 * parentheses, ampersands, or CJK characters) is permitted, because the
 * launcher passes the value as a distinct argv element to execFile (no
 * shell), so only traversal/separator characters are a real injection
 * vector.
 */
const PROFILE_DIRECTORY_FORBIDDEN =
  // \p{Cc} matches Unicode control characters (incl. NUL, newline, tab);
  // backslash and forward slash are path separators; a bare or dotted ".."
  // enables traversal. Using \p{Cc} (rather than a literal \x00-\x1f range)
  // keeps the pattern free of embedded control characters.
  /[\\/]|(?:^|[/\\])\.\.(?:[/\\]|$)|\p{Cc}/u;

/**
 * Validates a profile directory name against a denylist of dangerous
 * characters.
 *
 * Security: This guard prevents path traversal and command injection by
 * rejecting path separators (/, \), NUL/control characters, and traversal
 * sequences (..). Because the launcher uses execFile (no shell) and passes
 * the profile name as a discrete argv element, shell metacharacters are not
 * an injection vector, so legitimate display names containing parentheses,
 * ampersands, or Unicode characters are accepted.
 *
 * @param dir The profile directory name to validate
 * @throws Error if the name contains disallowed characters
 */
export function validateProfileDirectory(dir: string): void {
  if (
    !dir ||
    typeof dir !== 'string' ||
    PROFILE_DIRECTORY_FORBIDDEN.test(dir)
  ) {
    throw new Error(
      `Invalid profile directory: "${dir}". Path separators, control characters, and traversal sequences (..) are not allowed.`,
    );
  }
}

const FIREFOX_PROFILE_PATH_FORBIDDEN = /\p{Cc}/u;

function isFirefoxProfilePath(
  browser: BrowserKind,
  profileDirectory: string,
): boolean {
  return browser === 'firefox' && nodePath.isAbsolute(profileDirectory);
}

function validateBrowserProfileSelection(
  browser: BrowserKind,
  profileDirectory: string,
): void {
  if (isFirefoxProfilePath(browser, profileDirectory)) {
    if (FIREFOX_PROFILE_PATH_FORBIDDEN.test(profileDirectory)) {
      throw new Error(
        `Invalid Firefox profile path: "${profileDirectory}". Control characters are not allowed.`,
      );
    }
    return;
  }
  validateProfileDirectory(profileDirectory);
}

function firefoxProfileArguments(
  profileDirectory: string | undefined,
): string[] {
  if (!profileDirectory) {
    return [];
  }
  return [
    nodePath.isAbsolute(profileDirectory) ? '-profile' : '-P',
    profileDirectory,
  ];
}

/**
 * Opens a URL in the default browser using platform-specific commands.
 * This implementation avoids shell injection vulnerabilities by:
 * 1. Validating the URL to ensure it's HTTP/HTTPS only
 * 2. Using execFile instead of exec to avoid shell interpretation
 * 3. Passing the URL as an argument rather than constructing a command string
 *
 * When `options.browser` is set, launches that specific browser binary
 * directly (instead of the OS default browser), optionally with a specific
 * profile directory. This ensures OAuth always uses the intended browser
 * profile for the given bucket.
 *
 * @param url The URL to open
 * @param options Optional browser and profile directory selection
 * @throws Error if the URL is invalid or if opening the browser fails
 */
export async function openBrowserSecurely(
  url: string,
  options?: BrowserLaunchOptions,
): Promise<void> {
  validateUrl(url);

  if (options?.browser) {
    if (options.profileDirectory) {
      validateBrowserProfileSelection(
        options.browser,
        options.profileDirectory,
      );
    }
    await openSpecificBrowser(url, options.browser, options.profileDirectory);
    return;
  }

  await openDefaultBrowser(url);
}

/**
 * Open the OS-default browser for the given URL. This preserves the original
 * platform-specific behaviour (including the Linux fallback chain) used when
 * no particular browser/profile is requested.
 */
async function openDefaultBrowser(url: string): Promise<void> {
  const platformName = platform();
  let command: string;
  let args: string[];

  switch (platformName) {
    case 'darwin':
      command = 'open';
      args = [url];
      break;

    case 'win32':
      // PowerShell Start-Process avoids the cmd.exe shell injection surface.
      command = 'powershell.exe';
      args = [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        `Start-Process '${url.replace(/'/g, "''")}'`,
      ];
      break;

    case 'linux':
    case 'freebsd':
    case 'openbsd':
      command = 'xdg-open';
      args = [url];
      break;

    default:
      throw new Error(`Unsupported platform: ${platformName}`);
  }

  const execOptions = getBrowserExecOptions();
  try {
    await execFileAsync(command, args, execOptions);
  } catch (error) {
    if (isLinuxLike(platformName) && command === 'xdg-open') {
      const fallbackCommands = [
        'gnome-open',
        'kde-open',
        'firefox',
        'chromium',
        'google-chrome',
      ];
      const succeeded = await tryFallbackBrowserCommands(
        fallbackCommands,
        url,
        execOptions,
      );
      if (succeeded) {
        return;
      }
    }

    throw new Error(
      `Failed to open browser: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Checks if the current environment should attempt to launch a browser.
 * This is the same logic as in browser.ts for consistency.
 *
 * @param options Optional configuration to override browser launch behavior
 * @param options.forceManual When true, always returns false to force manual code entry
 * @returns True if the tool should attempt to launch a browser
 */
export function shouldLaunchBrowser(
  options?: { forceManual?: boolean } | undefined,
): boolean {
  if (options?.forceManual === true) {
    return false;
  }
  // A list of browser names that indicate we should not attempt to open a
  // web browser for the user.
  const browserBlocklist = ['www-browser'];
  const browserEnv = process.env.BROWSER;
  if (browserEnv && browserBlocklist.includes(browserEnv)) {
    return false;
  }

  // Common environment variables used in CI/CD or other non-interactive shells.
  if (process.env.CI || process.env.DEBIAN_FRONTEND === 'noninteractive') {
    return false;
  }

  // The presence of SSH_CONNECTION indicates a remote session.
  // We should not attempt to launch a browser unless a display is explicitly available
  // (checked below for Linux).
  const isSSH = !!process.env.SSH_CONNECTION;

  // On Linux, the presence of a display server is a strong indicator of a GUI.
  if (platform() === 'linux') {
    // These are environment variables that can indicate a running compositor on Linux.
    const displayVariables = ['DISPLAY', 'WAYLAND_DISPLAY', 'MIR_SOCKET'];
    const hasDisplay = displayVariables.some((v) => !!process.env[v]);
    if (!hasDisplay) {
      return false;
    }
  }

  // If in an SSH session on a non-Linux OS (e.g., macOS), don't launch browser.
  // The Linux case is handled above (it's allowed if DISPLAY is set).
  if (isSSH && platform() !== 'linux') {
    return false;
  }

  // For non-Linux OSes, we generally assume a GUI is available
  // unless other signals (like SSH) suggest otherwise.
  return true;
}

async function tryFallbackBrowserCommands(
  fallbackCommands: string[],
  url: string,
  options: BrowserExecOptions,
): Promise<boolean> {
  for (const fallbackCommand of fallbackCommands) {
    try {
      await execFileAsync(fallbackCommand, [url], options);
      return true;
    } catch {
      // Try next command
    }
  }
  return false;
}

/**
 * Launch a specific browser binary with an optional profile directory.
 *
 * Uses execFile (no shell) throughout to prevent command injection.
 * Profile directory names are validated by the caller via
 * {@link validateProfileDirectory} before reaching this function.
 */
async function openSpecificBrowser(
  url: string,
  browser: BrowserKind,
  profileDirectory: string | undefined,
): Promise<void> {
  const platformName = platform();
  let command: string;
  let args: string[];

  switch (browser) {
    case 'chrome':
      [command, args] = buildChromeLaunchArgs(
        platformName,
        profileDirectory,
        url,
      );
      break;

    case 'firefox':
      [command, args] = buildFirefoxLaunchArgs(
        platformName,
        profileDirectory,
        url,
      );
      break;

    case 'safari':
      if (platformName !== 'darwin') {
        throw new Error('Safari is only available on macOS');
      }
      // Safari has no profile concept; launch the app with the URL
      command = 'open';
      args = ['-a', 'Safari', url];
      break;

    default:
      throw new Error(`Unsupported browser: ${browser}`);
  }

  try {
    await execFileAsync(command, args, getBrowserExecOptions());
  } catch (error) {
    const succeeded =
      (await tryLinuxFallbackBinaries(platformName, browser, command, args)) ||
      (await tryWindowsFallbackBinaries(platformName, browser, command, args));
    if (succeeded) {
      return;
    }
    throw new Error(
      `Failed to open ${browser}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error },
    );
  }
}

/**
 * On Linux/BSD, the preferred Chrome/Firefox binary name varies by distro
 * (google-chrome vs. chromium, firefox vs. firefox-esr). This helper tries
 * the known fallback binaries for the given browser and resolves true if one
 * succeeded (so the caller can suppress the original error).
 *
 * Resolves false when the platform is not Linux/BSD, the browser has no
 * fallback list, or every fallback binary failed.
 */
async function tryLinuxFallbackBinaries(
  platformName: NodeJS.Platform,
  browser: BrowserKind,
  primaryCommand: string,
  args: string[],
): Promise<boolean> {
  if (!isLinuxLike(platformName)) {
    return false;
  }
  const fallbacks = linuxBrowserFallbacks(browser);
  const tried = new Set<string>([primaryCommand]);
  for (const fallback of fallbacks) {
    if (tried.has(fallback)) {
      continue;
    }
    tried.add(fallback);
    try {
      await execFileAsync(fallback, args, getBrowserExecOptions());
      return true;
    } catch {
      // Try the next fallback binary.
    }
  }
  return false;
}

/**
 * Resolve the candidate fallback binary names for a browser on Linux/BSD.
 * Returns an empty array for browsers without known alternates (e.g. Safari).
 */
function linuxBrowserFallbacks(browser: BrowserKind): string[] {
  if (browser === 'chrome') {
    return LINUX_CHROME_BINARIES;
  }
  if (browser === 'firefox') {
    return LINUX_FIREFOX_BINARIES;
  }
  return [];
}

/**
 * Resolve the candidate fallback paths for a browser on Windows. Returns an
 * empty array for browsers without known install locations (e.g. Safari).
 */
function windowsBrowserFallbackPaths(
  browser: BrowserKind,
): Array<() => string> {
  if (browser === 'chrome') {
    return WINDOWS_CHROME_PATHS;
  }
  if (browser === 'firefox') {
    return WINDOWS_FIREFOX_PATHS;
  }
  return [];
}

/**
 * On Windows, a bare `chrome.exe`/`firefox.exe` is only on PATH if the user
 * opted in during install. When it is missing (ENOENT), probe the typical
 * install locations under Program Files and LOCALAPPDATA and launch the first
 * one that exists. Resolves false when the platform is not Windows, the
 * browser has no fallback list, or every candidate failed.
 */
async function tryWindowsFallbackBinaries(
  platformName: NodeJS.Platform,
  browser: BrowserKind,
  primaryCommand: string,
  args: string[],
): Promise<boolean> {
  if (platformName !== 'win32') {
    return false;
  }
  const candidates = windowsBrowserFallbackPaths(browser);
  const tried = new Set<string>([primaryCommand]);
  for (const candidate of candidates) {
    const resolved = candidate();
    // Only attempt to execute real files so a directory at a candidate path is
    // not mistaken for a browser binary (execFileAsync would emit a confusing
    // EACCES/UNKNOWN error).
    const isExecutableFile = await stat(resolved)
      .then((candidateStat) => candidateStat.isFile())
      .catch(() => false);
    if (tried.has(resolved) || !isExecutableFile) {
      continue;
    }
    tried.add(resolved);
    try {
      await execFileAsync(resolved, args, getBrowserExecOptions());
      return true;
    } catch {
      // Try the next candidate path.
    }
  }
  return false;
}

/**
 * Build the command and arguments to launch Chrome/Chromium with a profile.
 */
function buildChromeLaunchArgs(
  platformName: NodeJS.Platform,
  profileDirectory: string | undefined,
  url: string,
): [string, string[]] {
  switch (platformName) {
    case 'darwin': {
      const args = ['-a', 'Google Chrome'];
      if (profileDirectory) {
        args.push('--args', `--profile-directory=${profileDirectory}`);
      }
      args.push(url);
      return ['open', args];
    }

    case 'win32': {
      // Invoke the Chrome executable directly via execFileAsync — no shell,
      // no PowerShell -Command string. Each argument is passed as a distinct
      // argv element so spaces in the profile directory are preserved and
      // there is no command-string boundary to inject through.
      const args: string[] = [];
      if (profileDirectory) {
        args.push(`--profile-directory=${profileDirectory}`);
      }
      args.push(url);
      return ['chrome.exe', args];
    }

    case 'linux':
    case 'freebsd':
    case 'openbsd': {
      const args: string[] = [];
      if (profileDirectory) {
        args.push(`--profile-directory=${profileDirectory}`);
      }
      args.push(url);
      return ['google-chrome', args];
    }

    default:
      throw new Error(`Unsupported platform for Chrome: ${platformName}`);
  }
}

/**
 * Build the command and arguments to launch Firefox with a profile.
 */
function buildFirefoxLaunchArgs(
  platformName: NodeJS.Platform,
  profileDirectory: string | undefined,
  url: string,
): [string, string[]] {
  const profileArguments = firefoxProfileArguments(profileDirectory);
  switch (platformName) {
    case 'darwin': {
      const args =
        profileArguments.length > 0
          ? ['-n', '-a', 'Firefox', '--args', ...profileArguments]
          : ['-a', 'Firefox'];
      args.push(url);
      return ['open', args];
    }

    case 'win32':
      return ['firefox.exe', [...profileArguments, url]];

    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return ['firefox', [...profileArguments, url]];

    default:
      throw new Error(`Unsupported platform for Firefox: ${platformName}`);
  }
}
