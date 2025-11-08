/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  OAuth2Client,
  Credentials,
  Compute,
  CodeChallengeMethod,
} from 'google-auth-library';
import * as http from 'http';
import url from 'url';
import crypto from 'crypto';
import * as net from 'net';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Config } from '../config/config.js';
import { getErrorMessage, FatalAuthenticationError } from '../utils/errors.js';
import { UserAccountManager } from '../utils/userAccountManager.js';
import { AuthType } from '../core/contentGenerator.js';
import readline from 'node:readline';
import open from 'open';
import { ClipboardService } from '../services/ClipboardService.js';
import { Storage } from '../config/storage.js';

const userAccountManager = new UserAccountManager();

//  OAuth Client ID used to initiate OAuth2Client class.
const OAUTH_CLIENT_ID =
  '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';

// OAuth Secret value used to initiate OAuth2Client class.
// Note: It's ok to save this in git because this is an installed application
// as described here: https://developers.google.com/identity/protocols/oauth2#installed
// "The process results in a client ID and, in some cases, a client secret,
// which you embed in the source code of your application. (In this context,
// the client secret is obviously not treated as a secret.)"
const OAUTH_CLIENT_SECRET = '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';

// OAuth Scopes for Cloud Code authorization.
const OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const HTTP_REDIRECT = 301;
const SIGN_IN_SUCCESS_URL = 'https://vybestack.dev/google/login.html';
const SIGN_IN_FAILURE_URL =
  'https://developers.google.com/gemini-code-assist/auth_failure_gemini';

/**
 * An Authentication URL for updating the credentials of a Oauth2Client
 * as well as a promise that will resolve when the credentials have
 * been refreshed (or which throws error when refreshing credentials failed).
 */
export interface OauthWebLogin {
  authUrl: string;
  loginCompletePromise: Promise<void>;
}

const oauthClientPromises = new Map<AuthType, Promise<OAuth2Client>>();

async function initOauthClient(
  authType: AuthType,
  config: Config,
): Promise<OAuth2Client> {
  // Handle USE_NONE auth type - skip OAuth entirely
  if (authType === AuthType.USE_NONE) {
    throw new Error('OAuth not required for USE_NONE auth type');
  }

  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
    transporterOptions: {
      proxy: config.getProxy(),
    },
  });

  if (
    process.env.GOOGLE_GENAI_USE_GCA &&
    process.env.GOOGLE_CLOUD_ACCESS_TOKEN
  ) {
    client.setCredentials({
      access_token: process.env.GOOGLE_CLOUD_ACCESS_TOKEN,
    });
    await fetchAndCacheUserInfo(client);
    return client;
  }

  client.on('tokens', (tokens: Credentials) => {
    // Don't await - cache credentials asynchronously to avoid blocking
    cacheCredentials(tokens).catch((error) => {
      console.error('Error caching OAuth tokens:', error);
    });
  });

  // If there are cached creds on disk, they always take precedence
  if (await loadCachedCredentials(client)) {
    // Found valid cached credentials.
    // Check if we need to retrieve Google Account ID or Email
    if (!userAccountManager.getCachedGoogleAccount()) {
      try {
        await fetchAndCacheUserInfo(client);
      } catch (error) {
        // Non-fatal, continue with existing auth.
        console.warn('Failed to fetch user info:', getErrorMessage(error));
      }
    }
    // Loaded cached credentials
    return client;
  }

  // In Google Cloud Shell, we can use Application Default Credentials (ADC)
  // provided via its metadata server to authenticate non-interactively using
  // the identity of the user logged into Cloud Shell.
  if (authType === AuthType.CLOUD_SHELL) {
    try {
      console.log("Attempting to authenticate via Cloud Shell VM's ADC.");
      const computeClient = new Compute({
        // We can leave this empty, since the metadata server will provide
        // the service account email.
      });
      await computeClient.getAccessToken();
      console.log('Authentication successful.');

      // Do not cache creds in this case; note that Compute client will handle its own refresh
      return computeClient;
    } catch (e) {
      throw new Error(
        `Could not authenticate using Cloud Shell credentials. Please select a different authentication method or ensure you are in a properly configured environment. Error: ${getErrorMessage(
          e,
        )}`,
      );
    }
  }

  if (config.isBrowserLaunchSuppressed()) {
    let success = false;
    const maxRetries = 2;
    for (let i = 0; !success && i < maxRetries; i++) {
      // Pass the addItem callback to authWithUserCode if browser launch is suppressed
      success = await authWithUserCode(
        client,
        (global as Record<string, unknown>).__oauth_add_item as
          | ((itemData: OAuthUrlItem, baseTimestamp: number) => number)
          | undefined,
      );
      if (!success) {
        console.error(
          '\nFailed to authenticate with user code.',
          i === maxRetries - 1 ? '' : 'Retrying...\n',
        );
      }
    }
    if (!success) {
      throw new FatalAuthenticationError(
        'Failed to authenticate with user code.',
      );
    }
  } else {
    const webLogin = await authWithWeb(client);

    // Always show the OAuth URL in the TUI first, before attempting browser
    const addItem = (global as Record<string, unknown>).__oauth_add_item as
      | ((itemData: OAuthUrlItem, baseTimestamp: number) => number)
      | undefined;

    if (addItem) {
      addItem(
        {
          type: 'oauth_url',
          text: `Please visit the following URL to authorize with Google Gemini:\n${webLogin.authUrl}`,
          url: webLogin.authUrl,
        },
        Date.now(),
      );
    }

    console.log(
      `\n\nCode Assist login required.\n` +
        `Attempting to open authentication page in your browser.\n` +
        `Otherwise navigate to:\n\n${webLogin.authUrl}\n\n`,
    );

    try {
      // Attempt to open the authentication URL in the default browser.
      // We do not use the `wait` option here because the main script's execution
      // is already paused by `loginCompletePromise`, which awaits the server callback.
      const childProcess = await open(webLogin.authUrl);

      // IMPORTANT: Attach an error handler to the returned child process.
      // Without this, if `open` fails to spawn a process (e.g., `xdg-open` is not found
      // in a minimal Docker container), it will emit an unhandled 'error' event,
      // causing the entire Node.js process to crash.
      childProcess.on('error', (error) => {
        console.error(
          'Failed to open browser automatically. Please try running again with NO_BROWSER=true set.',
        );
        console.error('Browser error details:', getErrorMessage(error));
      });
    } catch (_err) {
      console.error(
        'An unexpected error occurred while trying to open the browser:',
        getErrorMessage(_err),
        '\nThis might be due to browser compatibility issues or system configuration.',
        '\nPlease try running again with NO_BROWSER=true set for manual authentication.',
      );
      throw new FatalAuthenticationError(
        `Failed to open browser: ${getErrorMessage(_err)}`,
      );
    }

    if (typeof config.isInteractive === 'function' && config.isInteractive()) {
      console.log('Waiting for authentication...');
    }

    // Add timeout to prevent infinite waiting when browser tab gets stuck
    const authTimeout = 5 * 60 * 1000; // 5 minutes timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new FatalAuthenticationError(
            'Authentication timed out after 5 minutes. The browser tab may have gotten stuck in a loading state. ' +
              'Please try again or use NO_BROWSER=true for manual authentication.',
          ),
        );
      }, authTimeout);
    });

    await Promise.race([webLogin.loginCompletePromise, timeoutPromise]);

    // Reset global state variables after successful authentication
    /**
     * @plan PLAN-20250822-GEMINIFALLBACK.P13
     * @requirement REQ-004.2
     * @pseudocode lines 17-18, 25-26
     */
    (global as Record<string, unknown>).__oauth_needs_code = false;
    (global as Record<string, unknown>).__oauth_provider = undefined;
  }

  return client;
}

export async function performLogin(
  authType: AuthType,
  config: Config,
): Promise<boolean> {
  await initOauthClient(authType, config);
  return true;
}

export async function getOauthClient(
  authType: AuthType,
  config: Config,
): Promise<OAuth2Client> {
  if (!oauthClientPromises.has(authType)) {
    oauthClientPromises.set(authType, initOauthClient(authType, config));
  }
  return oauthClientPromises.get(authType)!;
}

interface OAuthUrlItem {
  type: 'oauth_url';
  text: string;
  url: string;
}

async function authWithUserCode(
  client: OAuth2Client,
  addItem?: (itemData: OAuthUrlItem, baseTimestamp: number) => number,
): Promise<boolean> {
  const redirectUri = 'https://codeassist.google.com/authcode';
  const codeVerifier = await client.generateCodeVerifierAsync();
  const state = crypto.randomBytes(32).toString('hex');
  const authUrl: string = client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: 'offline',
    scope: OAUTH_SCOPE,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: codeVerifier.codeChallenge,
    state,
  });

  // Add OAuth URL to history so user can copy it from the UI
  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P13
   * @requirement REQ-004.1
   * @pseudocode lines 11-13
   */
  if (addItem) {
    addItem(
      {
        type: 'oauth_url',
        text: `Please visit the following URL to authorize with Google Gemini:
${authUrl}`,
        url: authUrl,
      },
      Date.now(),
    );
  }

  // Try to copy URL to clipboard
  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P13
   * @requirement REQ-004.1
   * @pseudocode lines 11-13
   */
  const clipboardService = new ClipboardService();
  try {
    await clipboardService.copyToClipboard(authUrl);
    console.log(
      '\n\nCode Assist login required.\n' +
        'The authentication URL has been copied to your clipboard.\n' +
        'Please paste it into your browser to authenticate.\n' +
        'After authenticating, paste the verification code you receive below:\n\n',
    );
  } catch (clipboardError) {
    console.error('Failed to copy URL to clipboard:', clipboardError);
    // If clipboard copy fails, show the URL in a clean format without decorations
    console.log(
      '\nPlease visit the following URL to authorize the application:',
    );
    console.log(authUrl);
    console.log(
      '\nAfter authenticating, paste the verification code you receive below:',
    );
  }

  const code = await new Promise<string>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('Enter the authorization code: ', (code) => {
      rl.close();
      resolve(code.trim());
    });
  });

  if (!code) {
    console.error('Authorization code is required.');
    return false;
  }

  return authWithCode(client, code, codeVerifier, redirectUri);
}

async function authWithWeb(client: OAuth2Client): Promise<OauthWebLogin> {
  const port = await getAvailablePort();
  // The hostname used for the HTTP server binding (e.g., '0.0.0.0' in Docker).
  const host = process.env.OAUTH_CALLBACK_HOST || 'localhost';
  // The `redirectUri` sent to Google's authorization server MUST use a loopback IP literal
  // (i.e., 'localhost' or '127.0.0.1'). This is a strict security policy for credentials of
  // type 'Desktop app' or 'Web application' (when using loopback flow) to mitigate
  // authorization code interception attacks.
  const redirectUri = `http://localhost:${port}/oauth2callback`;
  const state = crypto.randomBytes(32).toString('hex');
  const authUrl = client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: 'offline',
    scope: OAUTH_SCOPE,
    state,
  });

  const loginCompletePromise = new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url!.indexOf('/oauth2callback') === -1) {
          res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_FAILURE_URL });
          res.end();
          reject(
            new FatalAuthenticationError(
              'OAuth callback not received. Unexpected request: ' + req.url,
            ),
          );
        }
        // acquire the code from the querystring, and close the web server.
        const qs = new url.URL(req.url!, 'http://localhost:3000').searchParams;
        if (qs.get('error')) {
          res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_FAILURE_URL });
          res.end();

          const errorCode = qs.get('error');
          const errorDescription =
            qs.get('error_description') || 'No additional details provided';
          reject(
            new FatalAuthenticationError(
              `Google OAuth error: ${errorCode}. ${errorDescription}`,
            ),
          );
        } else if (qs.get('state') !== state) {
          res.end('State mismatch. Possible CSRF attack');

          reject(
            new FatalAuthenticationError(
              'OAuth state mismatch. Possible CSRF attack or browser session issue.',
            ),
          );
        } else if (qs.get('code')) {
          try {
            const success = await authWithCode(
              client,
              qs.get('code')!,
              undefined,
              redirectUri,
            );

            if (!success) {
              throw new FatalAuthenticationError(
                'Failed to exchange authorization code for tokens.',
              );
            }

            res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_SUCCESS_URL });
            res.end();
            resolve();
          } catch (error) {
            res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_FAILURE_URL });
            res.end();
            reject(
              error instanceof FatalAuthenticationError
                ? error
                : new FatalAuthenticationError(
                    `Failed to exchange authorization code for tokens: ${getErrorMessage(error)}`,
                  ),
            );
          }
        } else {
          reject(
            new FatalAuthenticationError(
              'No authorization code received from Google OAuth. Please try authenticating again.',
            ),
          );
        }
      } catch (e) {
        // Provide more specific error message for unexpected errors during OAuth flow
        if (e instanceof FatalAuthenticationError) {
          reject(e);
        } else {
          reject(
            new FatalAuthenticationError(
              `Unexpected error during OAuth authentication: ${getErrorMessage(e)}`,
            ),
          );
        }
      } finally {
        server.close();
      }
    });

    server.listen(port, host, () => {
      // Server started successfully
    });

    server.on('error', (err) => {
      reject(
        new FatalAuthenticationError(
          `OAuth callback server error: ${getErrorMessage(err)}`,
        ),
      );
    });
  });

  return {
    authUrl,
    loginCompletePromise,
  };
}

export function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = 0;
    try {
      const portStr = process.env.OAUTH_CALLBACK_PORT;
      if (portStr) {
        port = parseInt(portStr, 10);
        if (isNaN(port) || port <= 0 || port > 65535) {
          return reject(
            new Error(`Invalid value for OAUTH_CALLBACK_PORT: ${portStr}`),
          );
        }
        return resolve(port);
      }
      const server = net.createServer();
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object' && 'port' in address) {
          resolve(address.port);
        } else {
          reject(new Error('Failed to get available port'));
        }
        server.close();
      });
      server.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

async function loadCachedCredentials(client: OAuth2Client): Promise<boolean> {
  const pathsToTry = [
    Storage.getOAuthCredsPath(),
    process.env['GOOGLE_APPLICATION_CREDENTIALS'],
  ].filter((p): p is string => !!p);

  for (const credPath of pathsToTry) {
    try {
      const credsJson = await fs.readFile(credPath, 'utf8');
      const creds = JSON.parse(credsJson) as Credentials;
      if (creds.refresh_token) {
        client.setCredentials(creds);
        return true;
      }
    } catch (error) {
      // Log specific error for debugging, but continue trying other paths
      console.debug(
        `Failed to load credentials from ${credPath}:`,
        getErrorMessage(error),
      );
    }
  }

  return false;
}

async function cacheCredentials(credentials: Credentials) {
  const filePath = Storage.getOAuthCredsPath();
  const dir = path.dirname(filePath);

  try {
    // Check if directory exists first to avoid unnecessary mkdir calls
    await fs.access(dir);
  } catch {
    // Directory doesn't exist, create it
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // Handle race condition where directory was created between access and mkdir
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        console.error('Failed to create OAuth cache directory:', error);
        // Don't throw - allow OAuth to continue without caching
        return;
      }
    }
  }

  try {
    // Write with restricted permissions (owner read/write only)
    await fs.writeFile(filePath, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
    });
    // Belt-and-suspenders: explicitly chmod the file for platforms where writeFile mode may not work
    try {
      await fs.chmod(filePath, 0o600);
    } catch {
      /* empty - file already has correct permissions from writeFile */
    }
  } catch (error) {
    console.error('Failed to cache OAuth credentials:', error);
    // Don't throw - allow OAuth to continue without caching
  }
}

export async function authWithCode(
  client: OAuth2Client,
  code: string,
  codeVerifier: { codeVerifier: string } | undefined,
  redirectUri: string,
): Promise<boolean> {
  try {
    const { tokens } = await client.getToken({
      code,
      redirect_uri: redirectUri,
      ...(codeVerifier ? { codeVerifier: codeVerifier.codeVerifier } : {}),
    });
    client.setCredentials(tokens);

    try {
      await fetchAndCacheUserInfo(client);
    } catch (error) {
      console.warn(
        'Failed to retrieve Google Account ID during authentication:',
        getErrorMessage(error),
      );
    }

    return true;
  } catch (error) {
    console.error(
      'Failed to authenticate with authorization code:',
      getErrorMessage(error),
    );
    return false;
  }
}

export async function clearCachedCredentialFile() {
  try {
    await fs.rm(Storage.getOAuthCredsPath(), { force: true });
    // Clear the Google Account ID cache when credentials are cleared
    await userAccountManager.clearCachedGoogleAccount();
    // Clear the in-memory OAuth client cache to force re-authentication
    clearOauthClientCache();
  } catch (e) {
    console.error('Failed to clear cached credentials:', e);
  }
}

async function fetchAndCacheUserInfo(client: OAuth2Client): Promise<void> {
  try {
    const { token } = await client.getAccessToken();
    if (!token) {
      return;
    }

    const response = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      console.error(
        'Failed to fetch user info:',
        response.status,
        response.statusText,
      );
      return;
    }

    const userInfo = (await response.json()) as { email?: string };
    if (userInfo.email) {
      await userAccountManager.cacheGoogleAccount(userInfo.email);
    }
  } catch (error) {
    console.error('Error retrieving user info:', error);
  }
}

/**
 * Clears the OAuth client cache to prevent session leakage during logout.
 * This is critical for security - without clearing the cache, users cannot properly logout.
 *
 * @param authType Optional specific auth type to clear. If not provided, clears entire cache.
 */
export function clearOauthClientCache(authType?: AuthType): void {
  try {
    if (authType) {
      oauthClientPromises.delete(authType);
    } else {
      oauthClientPromises.clear();
    }
  } catch (error) {
    // Log warning but don't throw - logout should continue even if cache clearing fails
    console.warn('Failed to clear OAuth client cache:', error);
  }
}

// Helper to ensure test isolation
export function resetOauthClientForTesting() {
  oauthClientPromises.clear();
}
