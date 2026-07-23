/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import { URL } from 'node:url';

const execFileAsync = promisify(execFile);
const WINDOWS_BROWSER_URL_ENV_VAR = 'LLXPRT_BROWSER_URL';

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

interface BrowserLaunchPlan {
  readonly command: string;
  readonly args: string[];
  readonly options: ExecFileOptions;
}

function createBrowserLaunchPlan(
  platformName: NodeJS.Platform,
  url: string,
): BrowserLaunchPlan {
  const env = {
    ...process.env,
    SHELL: undefined,
  };

  switch (platformName) {
    case 'darwin':
      return {
        command: 'open',
        args: [url],
        options: { env, shell: false },
      };
    case 'win32':
      return {
        command: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$browserUrl = $env:${WINDOWS_BROWSER_URL_ENV_VAR}; Remove-Item Env:${WINDOWS_BROWSER_URL_ENV_VAR}; Start-Process -FilePath $browserUrl`,
        ],
        options: {
          env: { ...env, [WINDOWS_BROWSER_URL_ENV_VAR]: url },
          shell: false,
          windowsHide: true,
        },
      };
    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return {
        command: 'xdg-open',
        args: [url],
        options: { env, shell: false },
      };
    default:
      throw new Error(`Unsupported platform: ${platformName}`);
  }
}

/**
 * Opens a URL in the default browser using platform-specific commands.
 * This implementation avoids shell injection vulnerabilities by:
 * 1. Validating the URL to ensure it's HTTP/HTTPS only
 * 2. Using execFile instead of exec to avoid shell interpretation
 * 3. Keeping URL data out of PowerShell command source
 *
 * @param url The URL to open
 * @throws Error if the URL is invalid or if opening the browser fails
 */
export async function openBrowserSecurely(url: string): Promise<void> {
  validateUrl(url);

  const platformName = platform();
  const launchPlan = createBrowserLaunchPlan(platformName, url);

  try {
    await execFileAsync(
      launchPlan.command,
      launchPlan.args,
      launchPlan.options,
    );
  } catch (error) {
    if (
      (platformName === 'linux' ||
        platformName === 'freebsd' ||
        platformName === 'openbsd') &&
      launchPlan.command === 'xdg-open'
    ) {
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
        launchPlan.options,
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
  fallbackCommands: readonly string[],
  url: string,
  options: ExecFileOptions,
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
