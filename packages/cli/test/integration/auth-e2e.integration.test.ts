/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20250823-AUTHFIXES.P15
 * @requirement:REQ-004
 * End-to-end integration tests for OAuth authentication
 *
 * TEST ISOLATION: these tests must NEVER operate on
 * the real `~/.llxprt` home directory. The token path is resolved through a
 * per-test canonical temp directory injected via the `LLXPRT_CONFIG_HOME`
 * env override, so every read/write/remove targets an isolated temp tree
 * that is removed in `afterEach`. The real user home is never touched.
 */
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'node:fs';

// Skip OAuth tests in CI as they require browser interaction
const skipInCI = process.env.CI === 'true';

describe.skipIf(skipInCI)('OAuth Authentication End-to-End Integration', () => {
  // Isolated per-test temp config root. The token directory is resolved
  // under this root instead of the real user home so the real ~/.llxprt is
  // never touched. `LLXPRT_CONFIG_HOME` is the canonical env override honored
  // by Storage; child CLI processes inherit it via the spawned env.
  let isolatedRoot: string;
  let tokenPath: string;
  let prevConfigHome: string | undefined;

  beforeEach(async () => {
    isolatedRoot = mkdtempSync(join(tmpdir(), 'llxprt-auth-e2e-'));
    tokenPath = join(isolatedRoot, 'oauth');
    prevConfigHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = isolatedRoot;
    // Clean token directory within the isolated root.
    await fs.rm(tokenPath, { recursive: true, force: true });
  });

  afterEach(async () => {
    if (prevConfigHome === undefined) {
      delete process.env.LLXPRT_CONFIG_HOME;
    } else {
      process.env.LLXPRT_CONFIG_HOME = prevConfigHome;
    }
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  /** Spawns the CLI inheriting the isolated config-home override. */
  function spawnCli(args: string[]): ReturnType<typeof spawn> {
    return spawn('npm', ['run', 'cli', '--', ...args], {
      env: { ...process.env },
    });
  }

  /**
   * @requirement:REQ-001
   * @scenario Tokens persist across CLI restarts
   */
  it('should persist tokens across complete CLI restarts', async () => {
    // Step 1: Save a valid token
    const validToken = {
      access_token: 'test-token-123',
      refresh_token: 'refresh-456',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
    };

    await fs.mkdir(tokenPath, { recursive: true });
    await fs.writeFile(
      join(tokenPath, 'qwen.json'),
      JSON.stringify(validToken),
      { mode: 0o600 },
    );

    // Step 2: Start CLI and verify no re-authentication required
    const cli = spawnCli([]);

    let output = '';
    cli.stdout.on('data', (data) => {
      output += data.toString();
    });

    // Send a command that requires auth
    cli.stdin.write('/auth qwen\n');

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify no authentication prompt appeared
    expect(output).not.toContain('Visit this URL to authorize');
    expect(output).toContain('authenticated');

    cli.kill();
  });

  /**
   * @requirement:REQ-002
   * @scenario Logout removes access completely
   */
  it('should completely remove access after logout command', async () => {
    // Step 1: Setup authenticated state
    const token = {
      access_token: 'valid-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
    };

    await fs.mkdir(tokenPath, { recursive: true });
    await fs.writeFile(
      join(tokenPath, 'anthropic.json'),
      JSON.stringify(token),
    );

    // Step 2: Run logout command
    const cli = spawnCli([]);

    cli.stdin.write('/auth anthropic logout\n');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Step 3: Verify token file removed
    const tokenExists = await fs
      .access(join(tokenPath, 'anthropic.json'))
      .then(() => true)
      .catch(() => false);

    expect(tokenExists).toBe(false);

    // Step 4: Try to use provider - should fail
    cli.stdin.write('/model anthropic:claude-3-opus\n');
    cli.stdin.write('Hello\n');

    let errorOutput = '';
    cli.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(errorOutput).toContain('authentication');

    cli.kill();
  });

  /**
   * @requirement:REQ-003
   * @scenario Expired tokens trigger refresh automatically
   */
  it('should automatically refresh expired tokens on use', async () => {
    // Step 1: Save nearly-expired token with refresh token
    const expiringToken = {
      access_token: 'old-access',
      refresh_token: 'valid-refresh',
      expiry: Math.floor(Date.now() / 1000) + 25, // Expires in 25 seconds
      token_type: 'Bearer',
    };

    await fs.mkdir(tokenPath, { recursive: true });
    await fs.writeFile(
      join(tokenPath, 'qwen.json'),
      JSON.stringify(expiringToken),
    );

    // Step 2: Use CLI - should trigger refresh
    const cli = spawnCli([]);

    cli.stdin.write('/model qwen\n');
    cli.stdin.write('Test message\n');

    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Step 3: Check token file was updated
    const updatedToken = JSON.parse(
      await fs.readFile(join(tokenPath, 'qwen.json'), 'utf8'),
    );

    expect(updatedToken.access_token).not.toBe('old-access');
    expect(updatedToken.expiry).toBeGreaterThan(expiringToken.expiry);

    cli.kill();
  });

  /**
   * @requirement:REQ-004
   * @scenario Multiple providers work independently
   */
  it('should handle multiple providers with independent sessions', async () => {
    // Setup tokens for multiple providers
    const qwenToken = {
      access_token: 'qwen-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
    };

    const anthropicToken = {
      access_token: 'sk-ant-oat-123',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
    };

    await fs.mkdir(tokenPath, { recursive: true });
    await fs.writeFile(join(tokenPath, 'qwen.json'), JSON.stringify(qwenToken));
    await fs.writeFile(
      join(tokenPath, 'anthropic.json'),
      JSON.stringify(anthropicToken),
    );

    const cli = spawnCli([]);

    // Logout from qwen only
    cli.stdin.write('/auth qwen logout\n');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Qwen token should be gone
    const qwenExists = await fs
      .access(join(tokenPath, 'qwen.json'))
      .then(() => true)
      .catch(() => false);
    expect(qwenExists).toBe(false);

    // Anthropic token should remain
    const anthropicExists = await fs
      .access(join(tokenPath, 'anthropic.json'))
      .then(() => true)
      .catch(() => false);
    expect(anthropicExists).toBe(true);

    cli.kill();
  });

  /**
   * @requirement:REQ-001, REQ-004
   * @scenario Real user workflow - authenticate once, use across sessions
   */
  it('should support real user workflow without re-authentication', async () => {
    // Simulate complete user workflow

    // 1. First session - authenticate
    const session1 = spawnCli([]);

    // Mock successful authentication
    const token = {
      access_token: 'user-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
    };
    await fs.mkdir(tokenPath, { recursive: true });
    await fs.writeFile(
      join(tokenPath, 'anthropic.json'),
      JSON.stringify(token),
    );

    session1.kill();

    // 2. Second session - should work without auth
    const session2 = spawnCli([]);

    let output2 = '';
    session2.stdout.on('data', (data) => {
      output2 += data.toString();
    });

    session2.stdin.write('/auth anthropic\n');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(output2).toContain('authenticated');
    expect(output2).not.toContain('Visit this URL');

    session2.kill();

    // 3. Third session - logout
    const session3 = spawnCli([]);

    session3.stdin.write('/auth anthropic logout\n');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    session3.kill();

    // 4. Fourth session - requires re-auth
    const session4 = spawnCli([]);

    let output4 = '';
    session4.stdout.on('data', (data) => {
      output4 += data.toString();
    });

    session4.stdin.write('/auth anthropic\n');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(output4).toContain('not authenticated');

    session4.kill();
  });
});
