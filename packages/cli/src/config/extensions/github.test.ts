/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkForExtensionUpdate,
  cloneFromGit,
  extractFile,
  findReleaseAsset,
  parseGitHubRepoForReleases,
  tryParseGithubUrl,
  downloadFromGitHubRelease,
} from './github.js';
import { simpleGit, type SimpleGit } from 'simple-git';
import { ExtensionUpdateState } from '../../ui/state/extensions.js';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as tar from 'tar';
import * as archiver from 'archiver';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const mockPlatform = vi.hoisted(() => vi.fn());
const mockArch = vi.hoisted(() => vi.fn());
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    platform: mockPlatform,
    arch: mockArch,
  };
});

const mockHttpsGet = vi.hoisted(() => vi.fn());
vi.mock('node:https', () => ({
  get: mockHttpsGet,
}));

vi.mock('simple-git');

const mockLoadExtension = vi.hoisted(() => vi.fn());
vi.mock('../extension.js', () => ({
  loadExtension: mockLoadExtension,
}));

describe('git extension helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cloneFromGit', () => {
    const mockGit = {
      clone: vi.fn(),
      getRemotes: vi.fn(),
      fetch: vi.fn(),
      checkout: vi.fn(),
    };

    beforeEach(() => {
      vi.mocked(simpleGit).mockReturnValue(mockGit as unknown as SimpleGit);
    });

    it('should clone, fetch and checkout a repo', async () => {
      const installMetadata = {
        source: 'http://my-repo.com',
        ref: 'my-ref',
        type: 'git' as const,
      };
      const destination = '/dest';
      mockGit.getRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'http://my-repo.com' } },
      ]);

      await cloneFromGit(installMetadata, destination);

      expect(mockGit.clone).toHaveBeenCalledWith('http://my-repo.com', './', [
        '--depth',
        '1',
      ]);
      expect(mockGit.getRemotes).toHaveBeenCalledWith(true);
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'my-ref');
      expect(mockGit.checkout).toHaveBeenCalledWith('FETCH_HEAD');
    });

    it('should use HEAD if ref is not provided', async () => {
      const installMetadata = {
        source: 'http://my-repo.com',
        type: 'git' as const,
      };
      const destination = '/dest';
      mockGit.getRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'http://my-repo.com' } },
      ]);

      await cloneFromGit(installMetadata, destination);

      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'HEAD');
    });

    it('should throw if no remotes are found', async () => {
      const installMetadata = {
        source: 'http://my-repo.com',
        type: 'git' as const,
      };
      const destination = '/dest';
      mockGit.getRemotes.mockResolvedValue([]);

      await expect(cloneFromGit(installMetadata, destination)).rejects.toThrow(
        'Failed to clone Git repository from http://my-repo.com',
      );
    });

    it('should throw on clone error', async () => {
      const installMetadata = {
        source: 'http://my-repo.com',
        type: 'git' as const,
      };
      const destination = '/dest';
      mockGit.clone.mockRejectedValue(new Error('clone failed'));

      await expect(cloneFromGit(installMetadata, destination)).rejects.toThrow(
        'Failed to clone Git repository from http://my-repo.com',
      );
    });
  });

  describe('tryParseGithubUrl', () => {
    it.each([
      ['https://github.com/owner/repo', 'owner', 'repo'],
      ['https://github.com/owner/repo.git', 'owner', 'repo'],
      ['git@github.com:owner/repo.git', 'owner', 'repo'],
      ['owner/repo', 'owner', 'repo'],
    ])('should parse %s to %s/%s', (url, owner, repo) => {
      expect(tryParseGithubUrl(url)).toStrictEqual({ owner, repo });
    });

    it.each([
      'https://gitlab.com/owner/repo',
      'https://my-git-host.com/owner/group/repo',
      'git@gitlab.com:some-group/some-project/some-repo.git',
    ])('should return null for non-GitHub URLs', (url) => {
      expect(tryParseGithubUrl(url)).toBeNull();
    });

    it('should throw for invalid formats', () => {
      expect(() => tryParseGithubUrl('invalid')).toThrow(
        'Invalid GitHub repository source',
      );
    });
  });

  describe('checkForExtensionUpdate', () => {
    const mockGit = {
      getRemotes: vi.fn(),
      listRemote: vi.fn(),
      revparse: vi.fn(),
    };

    beforeEach(() => {
      vi.mocked(simpleGit).mockReturnValue(mockGit as unknown as SimpleGit);
    });

    it('should return NOT_UPDATABLE for non-git extensions', async () => {
      const extension: GeminiCLIExtension = {
        name: 'test',
        path: '/ext',
        version: '1.0.0',
        isActive: true,
        installMetadata: {
          type: 'link',
          source: '',
        },
        contextFiles: [],
      };
      let result: ExtensionUpdateState | undefined = undefined;
      await checkForExtensionUpdate(
        extension,
        (newState) => (result = newState),
      );
      expect(result).toBe(ExtensionUpdateState.NOT_UPDATABLE);
    });

    it('should return ERROR if no remotes found', async () => {
      const extension: GeminiCLIExtension = {
        name: 'test',
        path: '/ext',
        version: '1.0.0',
        isActive: true,
        installMetadata: {
          type: 'git',
          source: '',
        },
        contextFiles: [],
      };
      mockGit.getRemotes.mockResolvedValue([]);
      let result: ExtensionUpdateState | undefined = undefined;
      await checkForExtensionUpdate(
        extension,
        (newState) => (result = newState),
      );
      expect(result).toBe(ExtensionUpdateState.ERROR);
    });

    it('should return UPDATE_AVAILABLE when remote hash is different', async () => {
      const extension: GeminiCLIExtension = {
        name: 'test',
        path: '/ext',
        version: '1.0.0',
        isActive: true,
        installMetadata: {
          type: 'git',
          source: 'my/ext',
        },
        contextFiles: [],
      };
      mockGit.getRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'http://my-repo.com' } },
      ]);
      mockGit.listRemote.mockResolvedValue('remote-hash\tHEAD');
      mockGit.revparse.mockResolvedValue('local-hash');

      let result: ExtensionUpdateState | undefined = undefined;
      await checkForExtensionUpdate(
        extension,
        (newState) => (result = newState),
      );
      expect(result).toBe(ExtensionUpdateState.UPDATE_AVAILABLE);
    });

    it('should return UP_TO_DATE when remote and local hashes are the same', async () => {
      const extension: GeminiCLIExtension = {
        name: 'test',
        path: '/ext',
        version: '1.0.0',
        isActive: true,
        installMetadata: {
          type: 'git',
          source: 'my/ext',
        },
        contextFiles: [],
      };
      mockGit.getRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'http://my-repo.com' } },
      ]);
      mockGit.listRemote.mockResolvedValue('same-hash\tHEAD');
      mockGit.revparse.mockResolvedValue('same-hash');

      let result: ExtensionUpdateState | undefined = undefined;
      await checkForExtensionUpdate(
        extension,
        (newState) => (result = newState),
      );
      expect(result).toBe(ExtensionUpdateState.UP_TO_DATE);
    });

    it('should return ERROR on git error', async () => {
      const extension: GeminiCLIExtension = {
        name: 'test',
        path: '/ext',
        version: '1.0.0',
        isActive: true,
        installMetadata: {
          type: 'git',
          source: 'my/ext',
        },
        contextFiles: [],
      };
      mockGit.getRemotes.mockRejectedValue(new Error('git error'));

      let result: ExtensionUpdateState | undefined = undefined;
      await checkForExtensionUpdate(
        extension,
        (newState) => (result = newState),
      );
      expect(result).toBe(ExtensionUpdateState.ERROR);
    });

    it('should return NOT_UPDATABLE and use console.warn when loadExtension returns null for local extension', async () => {
      const extension: GeminiCLIExtension = {
        name: 'local-test',
        path: '/ext',
        version: '1.0.0',
        isActive: true,
        installMetadata: {
          type: 'local',
          source: '/path/to/local/ext',
        },
        contextFiles: [],
      };

      // Mock loadExtension to return null (config can't be loaded)
      mockLoadExtension.mockReturnValue(null);

      // Spy on debugLogger.warn and debugLogger.error
      const debugWarnSpy = vi
        .spyOn(DebugLogger.prototype, 'warn')
        .mockImplementation(() => {});
      const debugErrorSpy = vi
        .spyOn(DebugLogger.prototype, 'error')
        .mockImplementation(() => {});

      let result: ExtensionUpdateState | undefined = undefined;
      await checkForExtensionUpdate(
        extension,
        (newState) => (result = newState),
      );

      // Assert: Should use NOT_UPDATABLE (not ERROR)
      expect(result).toBe(ExtensionUpdateState.NOT_UPDATABLE);

      // Assert: Should use debugLogger.warn (not debugLogger.error)
      expect(debugWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to check for update for local extension',
        ),
      );
      expect(debugErrorSpy).not.toHaveBeenCalled();

      debugWarnSpy.mockRestore();
      debugErrorSpy.mockRestore();
      mockLoadExtension.mockReset();
    });
  });

  describe('findReleaseAsset', () => {
    const assets = [
      { name: 'darwin.arm64.extension.tar.gz', url: 'url1' },
      { name: 'darwin.x64.extension.tar.gz', url: 'url2' },
      { name: 'linux.x64.extension.tar.gz', url: 'url3' },
      { name: 'win32.x64.extension.tar.gz', url: 'url4' },
      { name: 'extension-generic.tar.gz', url: 'url5' },
    ];

    it('should find asset matching platform and architecture', () => {
      mockPlatform.mockReturnValue('darwin');
      mockArch.mockReturnValue('arm64');
      const result = findReleaseAsset(assets);
      expect(result).toStrictEqual(assets[0]);
    });

    it('should find asset matching platform if arch does not match', () => {
      mockPlatform.mockReturnValue('linux');
      mockArch.mockReturnValue('arm64');
      const result = findReleaseAsset(assets);
      expect(result).toStrictEqual(assets[2]);
    });

    it('should return undefined if no matching asset is found', () => {
      mockPlatform.mockReturnValue('sunos');
      mockArch.mockReturnValue('x64');
      const result = findReleaseAsset(assets);
      expect(result).toBeUndefined();
    });

    it('should find generic asset if it is the only one', () => {
      const singleAsset = [{ name: 'extension.tar.gz', url: 'aurl5' }];

      mockPlatform.mockReturnValue('darwin');
      mockArch.mockReturnValue('arm64');
      const result = findReleaseAsset(singleAsset);
      expect(result).toStrictEqual(singleAsset[0]);
    });

    it('should return undefined if multiple generic assets exist', () => {
      const multipleGenericAssets = [
        { name: 'extension-1.tar.gz', url: 'aurl1' },
        { name: 'extension-2.tar.gz', url: 'aurl2' },
      ];
      mockPlatform.mockReturnValue('darwin');
      mockArch.mockReturnValue('arm64');
      const result = findReleaseAsset(multipleGenericAssets);
      expect(result).toBeUndefined();
    });
  });

  describe('parseGitHubRepoForReleases', () => {
    it('should parse owner and repo from a full GitHub URL', () => {
      const source = 'https://github.com/owner/repo.git';
      const { owner, repo } = parseGitHubRepoForReleases(source);
      expect(owner).toBe('owner');
      expect(repo).toBe('repo');
    });

    it('should parse owner and repo from a full GitHub URL without .git', () => {
      const source = 'https://github.com/owner/repo';
      const { owner, repo } = parseGitHubRepoForReleases(source);
      expect(owner).toBe('owner');
      expect(repo).toBe('repo');
    });

    it('should parse owner and repo from a full GitHub URL with a trailing slash', () => {
      const source = 'https://github.com/owner/repo/';
      const { owner, repo } = parseGitHubRepoForReleases(source);
      expect(owner).toBe('owner');
      expect(repo).toBe('repo');
    });

    it('should fail on a GitHub SSH URL', () => {
      const source = 'git@github.com:owner/repo.git';
      expect(() => parseGitHubRepoForReleases(source)).toThrow(
        'GitHub release-based extensions are not supported for SSH. You must use an HTTPS URI with a personal access token to download releases from private repositories. You can set your personal access token in the GITHUB_TOKEN environment variable and install the extension via HTTPS.',
      );
    });

    it('should fail on a non-GitHub URL', () => {
      const source = 'https://example.com/owner/repo.git';
      expect(() => parseGitHubRepoForReleases(source)).toThrow(
        'Invalid GitHub repository source: https://example.com/owner/repo.git. Expected "owner/repo" or a github repo uri.',
      );
    });

    it('should parse owner and repo from a shorthand string', () => {
      const source = 'owner/repo';
      const { owner, repo } = parseGitHubRepoForReleases(source);
      expect(owner).toBe('owner');
      expect(repo).toBe('repo');
    });

    it('should handle .git suffix in repo name', () => {
      const source = 'owner/repo.git';
      const { owner, repo } = parseGitHubRepoForReleases(source);
      expect(owner).toBe('owner');
      expect(repo).toBe('repo');
    });

    it('should throw error for invalid source format', () => {
      const source = 'invalid-format';
      expect(() => parseGitHubRepoForReleases(source)).toThrow(
        'Invalid GitHub repository source: invalid-format. Expected "owner/repo" or a github repo uri.',
      );
    });

    it('should throw error for source with too many parts', () => {
      const source = 'https://github.com/owner/repo/extra';
      expect(() => parseGitHubRepoForReleases(source)).toThrow(
        'Invalid GitHub repository source: https://github.com/owner/repo/extra. Expected "owner/repo" or a github repo uri.',
      );
    });
  });

  describe('extractFile', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-test-'));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should extract a .tar.gz file', async () => {
      const archivePath = path.join(tempDir, 'test.tar.gz');
      const extractionDest = path.join(tempDir, 'extracted');
      await fs.mkdir(extractionDest);

      // Create a dummy file to be archived
      const dummyFilePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(dummyFilePath, 'hello tar');

      // Create the tar.gz file
      await tar.c(
        {
          gzip: true,
          file: archivePath,
          cwd: tempDir,
        },
        ['test.txt'],
      );

      await extractFile(archivePath, extractionDest);

      const extractedFilePath = path.join(extractionDest, 'test.txt');
      const content = await fs.readFile(extractedFilePath, 'utf-8');
      expect(content).toBe('hello tar');
    });

    it('should extract a .zip file', async () => {
      const archivePath = path.join(tempDir, 'test.zip');
      const extractionDest = path.join(tempDir, 'extracted');
      await fs.mkdir(extractionDest);

      // Create a dummy file to be archived
      const dummyFilePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(dummyFilePath, 'hello zip');

      // Create the zip file
      const output = fsSync.createWriteStream(archivePath);
      const archive = archiver.create('zip');

      const streamFinished = new Promise((resolve, reject) => {
        output.on('close', () => resolve(null));
        archive.on('error', reject);
      });

      archive.pipe(output);
      archive.file(dummyFilePath, { name: 'test.txt' });
      await archive.finalize();
      await streamFinished;

      await extractFile(archivePath, extractionDest);

      const extractedFilePath = path.join(extractionDest, 'test.txt');
      const content = await fs.readFile(extractedFilePath, 'utf-8');
      expect(content).toBe('hello zip');
    });

    it('should throw an error for unsupported file types', async () => {
      const unsupportedFilePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(unsupportedFilePath, 'some content');
      const extractionDest = path.join(tempDir, 'extracted');
      await fs.mkdir(extractionDest);

      await expect(
        extractFile(unsupportedFilePath, extractionDest),
      ).rejects.toThrow('Unsupported file extension for extraction:');
    });
  });

  /**
   * @plan PLAN-20250219-GMERGE021.R14.P01
   * @requirement REQ-R14-003
   */
  function makeMockResponse(
    statusCode: number,
    headers: Record<string, string> = {},
  ) {
    const events: Record<string, (...args: unknown[]) => void> = {};
    const response = {
      statusCode,
      headers,
      on: (event: string, cb: (...args: unknown[]) => void) => {
        events[event] = cb;
        return response;
      },
      pipe: (dest: {
        on: (event: string, cb: (...args: unknown[]) => void) => void;
        close: (cb: () => void) => void;
      }) => {
        setImmediate(() => events['finish']?.());
        return dest;
      },
    };
    return response;
  }

  describe('downloadFromGitHubRelease', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(
        path.join(await fs.realpath(os.tmpdir()), 'github-download-test-'),
      );
      mockHttpsGet.mockClear();
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    /**
     * @plan PLAN-20250219-GMERGE021.R14.P02
     * @requirement REQ-R14-001
     */
    it('should include status code in error message from failed download', async () => {
      const mockRelease = {
        tag_name: 'v1.0.0',
        assets: [],
        tarball_url: 'https://api.github.com/repos/owner/repo/tarball/v1.0.0',
      };

      mockPlatform.mockReturnValue('darwin');
      mockArch.mockReturnValue('x64');

      mockHttpsGet.mockImplementation((_url, _options, callback) => {
        const response = makeMockResponse(403);
        callback(response);
        return { on: vi.fn().mockReturnThis() };
      });

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockRelease,
      } as Response);

      const installMetadata = {
        source: 'owner/repo',
        ref: 'v1.0.0',
        type: 'github-release' as const,
      };

      await expect(
        downloadFromGitHubRelease(installMetadata, tempDir),
      ).rejects.toThrow('403');
    });
  });

  describe('downloadFile', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(
        path.join(await fs.realpath(os.tmpdir()), 'download-file-test-'),
      );
      mockHttpsGet.mockClear();
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    /**
     * Test B: Verify that partial files are cleaned up on download failure
     * @requirement Audit issue #3 - downloadFile needs partial-file cleanup on failure
     */
    it('should clean up partial file on download failure', async () => {
      const { downloadFile } = await import('./github.js');
      const destPath = path.join(tempDir, 'test-file.tar.gz');

      // Mock https.get to return an error mid-stream
      mockHttpsGet.mockImplementation((_url, _options, _callback) => {
        // Don't call the callback, instead emit error on the request
        const request = {
          on: vi
            .fn()
            .mockImplementation(
              (event: string, handler: (error: Error) => void) => {
                if (event === 'error') {
                  setImmediate(() => handler(new Error('Network error')));
                }
                return request;
              },
            ),
        };
        return request;
      });

      await expect(
        downloadFile('https://example.com/file.tar.gz', destPath),
      ).rejects.toThrow('Network error');

      // Verify that the partial file was deleted
      const fileExists = await fs
        .access(destPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(false);
    });

    /**
     * Test C: Verify that partial files are cleaned up on response stream error
     * @requirement Audit issue #3 - downloadFile needs partial-file cleanup on failure
     */
    it('should clean up partial file on response stream error', async () => {
      const { downloadFile } = await import('./github.js');
      const destPath = path.join(tempDir, 'test-file.tar.gz');

      // Pre-create the file to simulate a partial download in progress
      await fs.writeFile(destPath, 'partial data');

      // Mock https.get to return a response that errors mid-stream
      mockHttpsGet.mockImplementation((_url, _options, callback) => {
        const events: Record<string, (error: Error) => void> = {};
        const response = {
          statusCode: 200,
          headers: {},
          destroy: vi.fn(),
          on: vi
            .fn()
            .mockImplementation(
              (event: string, handler: (error: Error) => void) => {
                events[event] = handler;
                return response;
              },
            ),
          pipe: vi.fn().mockImplementation((dest: unknown) => {
            // Simulate error after piping starts
            setImmediate(() => events['error']?.(new Error('Stream error')));
            return dest;
          }),
        };
        callback(response);
        return { on: vi.fn().mockReturnThis() };
      });

      await expect(
        downloadFile('https://example.com/file.tar.gz', destPath),
      ).rejects.toThrow('Stream error');

      // Allow async cleanup (fs.unlink) to settle — CI runners need more headroom
      await new Promise((r) => setTimeout(r, 200));

      // Verify that the partial file was deleted
      const fileExists = await fs
        .access(destPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(false);
    });
  });
});
