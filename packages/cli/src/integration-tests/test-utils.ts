/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { Profile } from '@vybestack/llxprt-code-core';

/**
 * Creates a temporary directory for tests
 * @returns Path to the created temporary directory
 */
export async function createTempDirectory(): Promise<string> {
  const prefix = 'llxprt-test-';
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return tempDir;
}

/**
 * Cleans up a temporary directory and all its contents
 * @param dir - Directory path to clean up
 */
export async function cleanupTempDirectory(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (error: unknown) {
    // Ignore errors if directory doesn't exist
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
}

/**
 * Creates a profile file in the specified directory
 * @param dir - Directory to create the profile in
 * @param name - Name of the profile (without .json extension)
 * @param profile - Profile data to write
 */
export async function createTempProfile(
  dir: string,
  name: string,
  profile: Profile,
): Promise<void> {
  const profilesDir = path.join(dir, '.llxprt', 'profiles');
  await fs.mkdir(profilesDir, { recursive: true });

  const profilePath = path.join(profilesDir, `${name}.json`);
  await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), 'utf8');
}

/**
 * Creates a keyfile with proper permissions (600)
 * @param dir - Directory to create the keyfile in
 * @param apiKey - API key content to write
 * @returns Path to the created keyfile
 */
export async function createTempKeyfile(
  dir: string,
  apiKey: string,
): Promise<string> {
  const keysDir = path.join(dir, '.keys');
  await fs.mkdir(keysDir, { recursive: true });

  const keyfilePath = path.join(keysDir, 'api-key');
  await fs.writeFile(keyfilePath, apiKey, { mode: 0o600 });

  return keyfilePath;
}

/**
 * Reads and parses settings.json from the specified directory
 * @param dir - Directory containing .llxprt/settings.json
 * @returns Parsed settings object
 */
export async function readSettingsFile(dir: string): Promise<unknown> {
  const settingsPath = path.join(dir, '.llxprt', 'settings.json');

  try {
    const content = await fs.readFile(settingsPath, 'utf8');
    return JSON.parse(content);
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return {};
    }
    throw error;
  }
}

/**
 * Writes settings.json to the specified directory
 * @param dir - Directory to write .llxprt/settings.json in
 * @param settings - Settings object to write
 */
export async function writeSettingsFile(
  dir: string,
  settings: unknown,
): Promise<void> {
  const llxprtDir = path.join(dir, '.llxprt');
  await fs.mkdir(llxprtDir, { recursive: true });

  const settingsPath = path.join(llxprtDir, 'settings.json');
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

/**
 * Waits for a file to exist with timeout
 * @param filepath - Path to the file to wait for
 * @param timeout - Maximum time to wait in milliseconds
 * @returns Promise that resolves when file exists or rejects on timeout
 */
export async function waitForFile(
  filepath: string,
  timeout: number,
): Promise<void> {
  const startTime = Date.now();
  const checkInterval = 100; // Check every 100ms

  while (Date.now() - startTime < timeout) {
    try {
      await fs.access(filepath);
      return; // File exists
    } catch {
      // File doesn't exist yet, wait and try again
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }
  }

  throw new Error(`Timeout waiting for file: ${filepath}`);
}

interface MockApiServerRequest {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface MockApiServer {
  server: http.Server;
  port: number;
  requests: MockApiServerRequest[];
  close: () => Promise<void>;
}

/**
 * Creates a simple HTTP server that logs requests
 * @returns Mock server object with server instance, port, and request log
 */
export async function createMockApiServer(): Promise<MockApiServer> {
  const requests: MockApiServerRequest[] = [];

  const server = http.createServer((req, res) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });

      // Send a simple success response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          message: 'Mock response',
        }),
      );
    });
  });

  // Find an available port
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to get server port');
  }

  return {
    server,
    port: address.port,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
  };
}
