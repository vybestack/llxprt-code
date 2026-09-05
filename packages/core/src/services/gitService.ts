/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { isNodeError } from '../utils/errors.js';
import { exec } from 'node:child_process';
import { simpleGit, type SimpleGit, CheckRepoActions } from 'simple-git';
import { ensureDir } from '../utils/paths.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { debugLogger } from '../utils/debugLogger.js';

/**
 * Marker file proving a persistent checkpoint store (a sandbox-owned volume
 * mounted by the CLI sandbox launcher) backs this exact history directory.
 * The sandbox init container writes it; GitService only reads it (#3464).
 */
export const CHECKPOINT_STORE_MARKER_FILENAME = '.llxprt-checkpoint-store';

/**
 * `SANDBOX` is set for every sandbox mode; container sandboxes set it to the
 * container name while the seatbelt sandbox uses the fixed 'sandbox-exec'
 * value (whose checkpoint history already lives in the persistent host data
 * dir and needs no store).
 */
function isContainerSandboxEnv(): boolean {
  const sandbox = process.env['SANDBOX'];
  return sandbox !== undefined && sandbox !== '' && sandbox !== 'sandbox-exec';
}

export class GitService {
  private projectRoot: string;
  private storage: Storage;

  constructor(projectRoot: string, storage: Storage) {
    this.projectRoot = path.resolve(projectRoot);
    this.storage = storage;
  }

  private getHistoryDir(): string {
    ensureDir(Storage.getGlobalDataDir());
    return this.storage.getHistoryDir();
  }

  async initialize(): Promise<void> {
    const gitAvailable = await this.verifyGitAvailability();
    if (!gitAvailable) {
      throw new Error(
        'Checkpointing is enabled, but Git is not installed. Please install Git or disable checkpointing to continue.',
      );
    }
    await this.assertPersistentCheckpointStore();
    try {
      await this.setupShadowGitRepository();
    } catch (error) {
      throw new Error(
        `Failed to initialize checkpointing: ${error instanceof Error ? error.message : 'Unknown error'}. Please check that Git is working properly or disable checkpointing.`,
      );
    }
  }

  /**
   * A container sandbox pins the data home inside its ephemeral $HOME, so
   * checkpoint history written there dies with the `--rm` container. When a
   * persistent checkpoint store backs this history directory, the sandbox
   * launcher has placed the marker file inside it; without the marker, fail
   * before relying on checkpoints that could never be restored (#3464).
   */
  private async assertPersistentCheckpointStore(): Promise<void> {
    if (!isContainerSandboxEnv()) {
      return;
    }
    const markerPath = path.join(
      this.getHistoryDir(),
      CHECKPOINT_STORE_MARKER_FILENAME,
    );
    try {
      await fs.access(markerPath);
    } catch {
      throw new Error(
        `Checkpointing is enabled inside a container sandbox, but the checkpoint history directory '${this.getHistoryDir()}' is not backed by a persistent checkpoint store, so checkpoints would be lost when the container exits. Start the sandbox from an LLxprt version that provisions persistent checkpoint storage, or disable checkpointing.`,
      );
    }
  }

  verifyGitAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
      exec('git --version', (error) => {
        if (error) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Creates a hidden git repository in the project root.
   * The Git repository is used to support checkpointing.
   */
  async setupShadowGitRepository() {
    const repoDir = this.getHistoryDir();
    const gitConfigPath = path.join(repoDir, '.gitconfig');

    await fs.mkdir(repoDir, { recursive: true });

    // We don't want to inherit the user's name, email, or gpg signing
    // preferences for the shadow repository, so we create a dedicated gitconfig.
    // `safe.directory = *` is scoped to this config (HOME and XDG_CONFIG_HOME
    // are pinned to the history dir for every shadow git invocation): it lets
    // a later sandbox run under a different selected uid keep using a
    // persistent store whose objects a previous uid wrote (#3464).
    // `core.autocrlf = false` is required because Git-for-Windows' SYSTEM
    // gitconfig (outside the HOME/XDG pinning) can set autocrlf=true, which
    // would rewrite LF to CRLF on `git restore`; checkpoint restores must be
    // byte-identical on every platform.
    const gitConfigContent =
      '[user]\n  name = llxprt-code\n  email = llxprt-code-bot@users.noreply.github.com\n[commit]\n  gpgsign = false\n[safe]\n  directory = *\n[core]\n  autocrlf = false\n';
    await fs.writeFile(gitConfigPath, gitConfigContent);

    // A work-tree `.gitattributes` (or a `core.attributesfile` from system/
    // global config) could otherwise re-enable text/eol conversion on `git
    // restore`; this repo-local attributes override disables it with the highest
    // precedence so checkpoint restores stay byte-identical.
    const attributesPath = path.join(repoDir, '.git', 'info', 'attributes');
    await fs.mkdir(path.dirname(attributesPath), { recursive: true });
    await fs.writeFile(attributesPath, '* -text\n');

    // The init-time instance reads config from the shadow dir itself (same
    // HOME/XDG pinning as every snapshot/restore invocation): a container
    // sandbox has no user gitconfig to derive an identity from, so the
    // initial commit must take its author from the .gitconfig just written
    // above or every first run inside a sandbox dies with "Author identity
    // unknown" (#3464).
    const repo = simpleGit(repoDir).env({
      HOME: repoDir,
      XDG_CONFIG_HOME: repoDir,
    });
    let isRepoDefined = false;
    try {
      isRepoDefined = await repo.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
    } catch (error) {
      // If checkIsRepo fails (e.g., on certain Git versions like macOS 2.39.5),
      // log the error and assume repo is not defined, then proceed with initialization
      debugLogger.debug(
        `checkIsRepo failed, will initialize repository: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!isRepoDefined) {
      await repo.init(false, {
        '--initial-branch': 'main',
      });

      await repo.commit('Initial commit', { '--allow-empty': null });
    }

    const userGitIgnorePath = path.join(this.projectRoot, '.gitignore');
    const shadowGitIgnorePath = path.join(repoDir, '.gitignore');

    let userGitIgnoreContent = '';
    try {
      userGitIgnoreContent = await fs.readFile(userGitIgnorePath, 'utf-8');
    } catch (error) {
      if (isNodeError(error) && error.code !== 'ENOENT') {
        throw error;
      }
    }

    await fs.writeFile(shadowGitIgnorePath, userGitIgnoreContent);
    await this.syncProjectExcludeRules();
  }

  /**
   * Mirrors the project's repository-local exclude rules into the shadow
   * repository. Git honors the work tree's root and nested `.gitignore`
   * files automatically, but `$GIT_DIR/info/exclude` belongs to the shadow
   * repository, so the project's exclude rules would otherwise never apply
   * to snapshots. Synced at setup and before every snapshot so edits during
   * a session are honored (#3464).
   */
  private async syncProjectExcludeRules(): Promise<void> {
    const projectExcludePath = path.join(
      this.projectRoot,
      '.git',
      'info',
      'exclude',
    );
    let excludeContent = '';
    try {
      excludeContent = await fs.readFile(projectExcludePath, 'utf-8');
    } catch (error) {
      if (isNodeError(error) && error.code !== 'ENOENT') {
        throw error;
      }
    }
    const shadowInfoDir = path.join(this.getHistoryDir(), '.git', 'info');
    await fs.mkdir(shadowInfoDir, { recursive: true });
    await fs.writeFile(path.join(shadowInfoDir, 'exclude'), excludeContent);
  }

  private get shadowGitRepository(): SimpleGit {
    const repoDir = this.getHistoryDir();
    return simpleGit(this.projectRoot).env({
      GIT_DIR: path.join(repoDir, '.git'),
      GIT_WORK_TREE: this.projectRoot,
      // Prevent git from using the user's global git config.
      HOME: repoDir,
      XDG_CONFIG_HOME: repoDir,
    });
  }

  async getCurrentCommitHash(): Promise<string> {
    const hash = await this.shadowGitRepository.raw('rev-parse', 'HEAD');
    return hash.trim();
  }

  async createFileSnapshot(message: string): Promise<string> {
    try {
      await this.syncProjectExcludeRules();
      const repo = this.shadowGitRepository;
      await repo.add('.');
      const commitResult = await repo.commit(message, {
        '--no-verify': null,
      });
      return commitResult.commit;
    } catch (error) {
      throw new Error(
        `Failed to create checkpoint snapshot: ${error instanceof Error ? error.message : 'Unknown error'}. Checkpointing may not be working properly.`,
      );
    }
  }

  async restoreProjectFromSnapshot(commitHash: string): Promise<void> {
    const repo = this.shadowGitRepository;
    await repo.raw(['restore', '--source', commitHash, '.']);
    // Removes any untracked files that were introduced post snapshot.
    await repo.clean('f', ['-d']);
  }
}
