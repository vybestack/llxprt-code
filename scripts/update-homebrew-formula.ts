/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  createWriteStream,
  type PathLike,
  type PathOrFileDescriptor,
} from 'node:fs';
import { resolve, join } from 'node:path';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';

/**
 * Updates the Homebrew formula for llxprt-code in the vybestack/homebrew-tap repository.
 *
 * This script:
 * - Fetches the npm tarball for a specific version
 * - Calculates the SHA256 checksum
 * - Generates the Homebrew formula Ruby file
 * - Clones/updates the tap repository
 * - Commits and pushes changes
 *
 * Environment variables:
 * - HOMEBREW_TAP_TOKEN: GitHub token for pushing to homebrew-tap repo (required)
 * - DRY_RUN: If set to 'true', skip git operations (default: false)
 *
 * Arguments:
 * - version: The version to publish (e.g., "0.9.0"). If not provided, reads from package.json
 */

/**
 * Downloads a file from a URL to a local path
 * @param {string} url - URL to download from
 * @param {string} destPath - Local path to save the file
 * @returns {Promise<void>}
 */
async function downloadFile(
  url: string | URL | https.RequestOptions,
  destPath: PathLike,
): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          const location = response.headers.location;
          if (!location) {
            reject(new Error('Redirect response missing location header'));
            return;
          }
          // Follow redirects
          downloadFile(location, destPath).then(resolvePromise).catch(reject);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }
        const fileStream = createWriteStream(destPath);
        pipeline(response, fileStream)
          .then(() => resolvePromise())
          .catch(reject);
      })
      .on('error', reject);
  });
}

/**
 * Calculates the SHA256 hash of a file
 * @param {string} filePath - Path to the file
 * @returns {string} The SHA256 hash in hexadecimal
 */
function calculateSHA256(filePath: PathOrFileDescriptor): string {
  const fileBuffer = readFileSync(filePath);
  const hash = createHash('sha256');
  hash.update(fileBuffer);
  return hash.digest('hex');
}

/**
 * Generates the Homebrew formula content
 * @param {string} version - The package version (without 'v' prefix)
 * @param {string} sha256 - The SHA256 checksum of the tarball
 * @returns {string} The formula content
 */
function generateFormula(version: string, sha256: string): string {
  return `class LlxprtCode < Formula
  desc "AI-powered coding assistant CLI"
  homepage "https://github.com/vybestack/llxprt-code"
  url "https://registry.npmjs.org/@vybestack/llxprt-code/-/llxprt-code-${version}.tgz"
  sha256 "${sha256}"
  license "Apache-2.0"

  depends_on "node"
  depends_on "bun"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/llxprt --version")
  end
end
`;
}

/**
 * Executes a shell command with error handling
 * @param {string} command - The command to execute
 * @param {object} options - Options for execSync
 * @returns {string} The command output
 */
function runCommand(
  command: string,
  options: Record<string, unknown> = {},
): string {
  console.log(`> ${command}`);
  try {
    return execSync(command, {
      stdio: 'inherit',
      encoding: 'utf-8',
      ...options,
    });
  } catch (error) {
    console.error(`Command failed: ${command}`);
    throw error;
  }
}

/**
 * Resolves and validates the version string from CLI arg or package.json.
 */
function resolveVersion(versionArg: string): string | null {
  let version = versionArg;
  if (!version) {
    const packageJsonPath = resolve(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    version = packageJson.version;
    console.log(`Using version from package.json: ${version}`);
  } else {
    version = version.replace(/^v/, '');
    console.log(`Using version from argument: ${version}`);
  }

  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(
      `Invalid version format: ${version}. Expected format: X.Y.Z`,
    );
  }

  if (version.includes('-')) {
    console.log(`Skipping Homebrew update for pre-release version: ${version}`);
    return null;
  }

  return version;
}

/**
 * Downloads the npm tarball and returns the SHA256 checksum and formula content.
 */
async function downloadAndGenerateFormula(version: string): Promise<string> {
  const tarballUrl = `https://registry.npmjs.org/@vybestack/llxprt-code/-/llxprt-code-${version}.tgz`;
  const tmpDir = tmpdir();
  const tarballPath = join(tmpDir, `llxprt-code-${version}.tgz`);

  console.log(`Downloading tarball from ${tarballUrl}...`);
  try {
    await downloadFile(tarballUrl, tarballPath);
    console.log('Tarball downloaded successfully');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to download tarball: ${message}`);
  }

  console.log('Calculating SHA256 checksum...');
  const sha256 = calculateSHA256(tarballPath);
  console.log(`SHA256: ${sha256}`);

  const formulaContent = generateFormula(version, sha256);
  console.log('Generated formula:');
  console.log(formulaContent);

  rmSync(tarballPath, { force: true });
  return formulaContent;
}

/**
 * Clones the tap repository and configures git. Returns the tap directory path.
 */
function setupTapRepo(token: string | undefined): string {
  const tmpDir = tmpdir();
  const tapDir = join(tmpDir, 'homebrew-tap');
  const tapRepoBase = 'https://github.com/vybestack/homebrew-tap.git';

  console.log('Setting up tap repository...');
  try {
    rmSync(tapDir, { recursive: true, force: true });
    runCommand(`git clone ${tapRepoBase} ${tapDir}`, { stdio: 'ignore' });
    if (token) {
      const tapRepoAuth = `https://${token}@github.com/vybestack/homebrew-tap.git`;
      execFileSync('git', ['remote', 'set-url', 'origin', tapRepoAuth], {
        cwd: tapDir,
        stdio: 'ignore',
      });
    }
    console.log('Cloned tap repository');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to clone tap repository: ${message}`);
  }

  runCommand('git config user.name "github-actions[bot]"', {
    cwd: tapDir,
    stdio: 'ignore',
  });
  runCommand(
    'git config user.email "github-actions[bot]@users.noreply.github.com"',
    { cwd: tapDir, stdio: 'ignore' },
  );

  return tapDir;
}

/**
 * Writes the formula file, commits, and pushes changes.
 */
function commitAndPush(
  tapDir: PathLike,
  formulaContent: string,
  version: string,
): void {
  const tapDirStr = String(tapDir);
  const formulaDir = join(tapDirStr, 'Formula');
  mkdirSync(formulaDir, { recursive: true });

  const formulaPath = join(formulaDir, 'llxprt-code.rb');
  writeFileSync(formulaPath, formulaContent);
  console.log(`Updated formula at ${formulaPath}`);

  try {
    runCommand('git add Formula/llxprt-code.rb', {
      cwd: tapDirStr,
      stdio: 'ignore',
    });

    try {
      runCommand('git diff --cached --quiet', {
        cwd: tapDirStr,
        stdio: 'ignore',
      });
      console.log('No changes to commit - formula already up to date');
    } catch {
      runCommand(`git commit -m "Update llxprt-code to ${version}"`, {
        cwd: tapDirStr,
        stdio: 'ignore',
      });
      console.log('Committed changes');

      runCommand('git push origin main', {
        cwd: tapDirStr,
        stdio: 'ignore',
      });
      console.log('Pushed changes to GitHub');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to commit/push changes: ${message}`);
  } finally {
    rmSync(tapDirStr, { recursive: true, force: true });
  }
}

/**
 * Main function to update the Homebrew formula
 */
async function main(): Promise<void> {
  const versionArg = process.argv[2] ?? '';
  const dryRun = process.env.DRY_RUN === 'true';
  const token = process.env.HOMEBREW_TAP_TOKEN;

  console.log('Starting Homebrew formula update...');
  console.log(`Dry run: ${dryRun}`);

  const version = resolveVersion(versionArg);
  if (version === null) return;

  if (!dryRun && !token) {
    throw new Error(
      'HOMEBREW_TAP_TOKEN environment variable is required for publishing',
    );
  }

  const formulaContent = await downloadAndGenerateFormula(version);

  if (dryRun) {
    console.log('Dry run mode - skipping git operations');
    return;
  }

  const tapDir = setupTapRepo(token);
  commitAndPush(tapDir, formulaContent, version);

  console.log(
    `Successfully updated Homebrew formula for llxprt-code ${version}`,
  );
}

// Run the script
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Error updating Homebrew formula:', message);
  process.exit(1);
});
