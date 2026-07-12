/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import { URL } from 'node:url';

const execFileAsync = promisify(execFile);

/**
 * Supported browser kinds for targeted launching.
 */
export type BrowserKind = 'chrome' | 'firefox' | 'safari';

/**
 * Options for launching a specific browser binary with an optional profile.
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
 * Strict allowlist for profile directory names.
 * Matches Chrome's "Profile 1", "Default", Firefox profile names, etc.
 * Rejects path traversal (..), separators (/ \), control chars, and shell
 * metacharacters to prevent command injection.
 */
const PROFILE_DIRECTORY_PATTERN = /^[A-Za-z0-9 _.-]+$/;

/**
 * Validates a profile directory name against a strict allowlist.
 *
 * Security: This guard prevents command injection by rejecting any character
 * that could be interpreted as a path separator, shell metacharacter, or
 * control character. Only alphanumeric, space, underscore, dot, and hyphen
 * are permitted.
 *
 * @param dir The profile directory name to validate
 * @throws Error if the name contains disallowed characters
 */
export function validateProfileDirectory(dir: string): void {
  if (!dir || typeof dir !== 'string' || !PROFILE_DIRECTORY_PATTERN.test(dir)) {
    throw new Error(
      `Invalid profile directory: "${dir}". Only alphanumeric, space, underscore, dot, and hyphen are allowed.`,
    );
  }
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
      validateProfileDirectory(options.profileDirectory);
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

  const execOptions: Record<string, unknown> = {
    env: { ...process.env, SHELL: undefined },
    detached: true,
    stdio: 'ignore',
  };

  try {
    await execFileAsync(command, args, execOptions);
  } catch (error) {
    const isLinuxLike =
      platformName === 'linux' ||
      platformName === 'freebsd' ||
      platformName === 'openbsd';
    if (isLinuxLike && command === 'xdg-open') {
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
  options: Record<string, unknown>,
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

const specificBrowserExecOptions: Record<string, unknown> = {
  env: { ...process.env, SHELL: undefined },
  detached: true,
  stdio: 'ignore',
};

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
    await execFileAsync(command, args, specificBrowserExecOptions);
  } catch (error) {
    throw new Error(
      `Failed to open ${browser}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Single-quote a value for safe embedding in a PowerShell single-quoted
 * string literal. PowerShell escapes a literal single quote by doubling it.
 */
function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Build a `Start-Process` PowerShell command that passes each browser
 * argument and the URL as separate elements of a PowerShell array
 * (`-ArgumentList @('a','b',...)`). Array elements are individually
 * single-quoted so values containing spaces (e.g. a Chrome profile
 * directory named "Profile 1") are preserved instead of being split on
 * whitespace.
 */
function buildStartProcessCommand(
  executable: string,
  browserArgs: string[],
  url: string,
): string {
  const quotedUrl = powershellQuote(url);
  const argList =
    browserArgs.length > 0
      ? `@(${browserArgs.join(',')},${quotedUrl})`
      : quotedUrl;
  return `Start-Process '${executable}' -ArgumentList ${argList}`;
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
      // Use Start-Process with chrome.exe and the profile arg.
      // Pass -ArgumentList as a PowerShell array of separately single-quoted
      // strings so spaces in the profile directory (e.g. "Profile 1") are
      // preserved. A single unquoted string would be split on whitespace by
      // PowerShell, truncating --profile-directory=Profile 1 to =Profile.
      const chromeArgs: string[] = [];
      if (profileDirectory) {
        chromeArgs.push(
          powershellQuote(`--profile-directory=${profileDirectory}`),
        );
      }
      return [
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-Command',
          buildStartProcessCommand('chrome.exe', chromeArgs, url),
        ],
      ];
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
  switch (platformName) {
    case 'darwin': {
      const args = ['-a', 'Firefox'];
      if (profileDirectory) {
        args.push('--args', '-P', profileDirectory);
      }
      args.push(url);
      return ['open', args];
    }

    case 'win32': {
      // Pass -ArgumentList as a PowerShell array so spaces in the profile
      // name are preserved (see buildChromeLaunchArgs win32 note).
      const firefoxArgs: string[] = [];
      if (profileDirectory) {
        firefoxArgs.push(
          powershellQuote('-P'),
          powershellQuote(profileDirectory),
        );
      }
      return [
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-Command',
          buildStartProcessCommand('firefox', firefoxArgs, url),
        ],
      ];
    }

    case 'linux':
    case 'freebsd':
    case 'openbsd': {
      const args: string[] = [];
      if (profileDirectory) {
        args.push('-P', profileDirectory);
      }
      args.push(url);
      return ['firefox', args];
    }

    default:
      throw new Error(`Unsupported platform for Firefox: ${platformName}`);
  }
}
