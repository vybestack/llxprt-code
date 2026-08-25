/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  utimes,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LocalMediaStoreFileOperations } from './local-media-store-types.js';
import {
  MediaObjectCorruptError,
  MediaObjectMissingError,
  MediaStoreError,
} from './local-media-store-types.js';
import {
  digestFor,
  hasErrnoCode,
  validateContentId,
  wrapError,
} from './local-media-store-validation.js';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const COPY_BUFFER_BYTES = 64 * 1024;

interface FileCopyResult {
  readonly digest: string;
  readonly byteLength: number;
}

export class LocalMediaStoreFiles {
  readonly rootDirectory: string;
  readonly objectDirectory: string;
  readonly temporaryDirectory: string;
  readonly reservationDirectory: string;
  readonly instanceDirectory: string;
  readonly lockDirectory: string;
  readonly lockPath: string;
  private readonly fileOperations: LocalMediaStoreFileOperations;

  constructor(
    rootDirectory: string,
    fileOperations: LocalMediaStoreFileOperations | undefined,
  ) {
    this.rootDirectory = rootDirectory;
    this.objectDirectory = join(rootDirectory, 'objects', 'sha256');
    this.temporaryDirectory = join(rootDirectory, 'temporary');
    this.reservationDirectory = join(rootDirectory, 'references', 'sha256');
    this.instanceDirectory = join(rootDirectory, 'instances');
    this.lockDirectory = join(rootDirectory, 'locks');
    this.lockPath = join(this.lockDirectory, 'store.lock');
    this.fileOperations = fileOperations ?? { link, rename };
  }

  async ensureDirectories(contentId: string | undefined): Promise<void> {
    const directories = [
      this.rootDirectory,
      join(this.rootDirectory, 'objects'),
      this.objectDirectory,
      this.temporaryDirectory,
      join(this.rootDirectory, 'references'),
      this.reservationDirectory,
      this.instanceDirectory,
      this.lockDirectory,
    ];
    for (const directory of directories) {
      await this.ensureDirectory(
        directory,
        contentId,
        'initialize directories',
      );
    }
  }

  async ensureDirectory(
    path: string,
    contentId: string | undefined,
    operation: string,
  ): Promise<void> {
    try {
      if (path === this.rootDirectory) {
        await this.ensureRootDirectory(path);
      } else {
        await this.createDirectory(path);
      }
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) {
        throw new Error('Managed media directory must not be a symbolic link');
      }
      if (!metadata.isDirectory()) {
        throw new Error('Managed media path is not a directory');
      }
      if (process.platform !== 'win32') {
        await chmod(path, DIRECTORY_MODE);
        const restored = await lstat(path);
        if (
          restored.isSymbolicLink() ||
          !restored.isDirectory() ||
          (restored.mode & 0o777) !== DIRECTORY_MODE
        ) {
          throw new Error(
            'Managed media directory permissions were not restored',
          );
        }
      }
    } catch (error) {
      throw wrapError(operation, contentId, error);
    }
  }

  private async createDirectory(path: string): Promise<void> {
    try {
      await mkdir(path, { mode: DIRECTORY_MODE });
    } catch (error) {
      if (!hasErrnoCode(error, 'EEXIST')) throw error;
    }
  }

  private async ensureRootDirectory(path: string): Promise<void> {
    try {
      const existing = await lstat(path);
      if (existing.isSymbolicLink()) {
        throw new Error('Managed media root must not be a symbolic link');
      }
      return;
    } catch (error) {
      if (!hasErrnoCode(error, 'ENOENT')) throw error;
    }
    await mkdir(path, { recursive: true, mode: DIRECTORY_MODE });
  }

  async inspectReclamationCandidate(path: string): Promise<void> {
    await this.fileOperations.inspectReclamationCandidate?.(path);
  }

  async syncDirectory(path: string): Promise<void> {
    if (this.fileOperations.syncDirectory !== undefined) {
      await this.fileOperations.syncDirectory(path);
      return;
    }
    if (process.platform === 'win32') return;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let failure: unknown;
    try {
      handle = await open(path, 'r');
      await handle.sync();
    } catch (error) {
      failure = error;
    }
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch (closeError) {
        failure =
          failure === undefined
            ? closeError
            : new AggregateError([failure, closeError]);
      }
    }
    if (failure !== undefined) {
      throw wrapError('sync directory', undefined, failure);
    }
  }

  objectPath(contentId: string): string {
    validateContentId(contentId, 'derive object path');
    return join(this.objectDirectory, digestFor(contentId));
  }

  async readRegularFile(
    path: string,
    contentId: string,
    operation: string,
  ): Promise<Buffer> {
    let objectStat: Awaited<ReturnType<typeof lstat>>;
    try {
      objectStat = await lstat(path);
    } catch (error) {
      if (hasErrnoCode(error, 'ENOENT')) {
        throw new MediaObjectMissingError(operation, contentId, error);
      }
      throw wrapError(`${operation} metadata`, contentId, error);
    }
    if (!objectStat.isFile()) {
      throw new MediaObjectCorruptError(
        operation,
        contentId,
        new Error('Stored object is not a regular file'),
      );
    }
    try {
      return await readFile(path);
    } catch (error) {
      if (hasErrnoCode(error, 'ENOENT')) {
        throw new MediaObjectMissingError(operation, contentId, error);
      }
      throw wrapError(`${operation} bytes`, contentId, error);
    }
  }

  instancePath(instanceId: string): string {
    return join(this.instanceDirectory, instanceId);
  }

  async publishObjectBytes(
    bytes: Uint8Array,
    contentId: string,
    operation: string,
  ): Promise<string | undefined> {
    const path = this.objectPath(contentId);
    const created = await this.publishBytes(bytes, path, contentId, operation);
    return created ? path : undefined;
  }

  async publishInstanceBytes(
    bytes: Uint8Array,
    instanceId: string,
    contentId: string,
  ): Promise<void> {
    const destinationPath = this.instancePath(instanceId);
    const created = await this.publishBytes(
      bytes,
      destinationPath,
      contentId,
      'publish instance lease',
    );
    if (!created) {
      throw new MediaStoreError(
        'publish instance lease',
        contentId,
        new Error('Instance lease identity already exists'),
      );
    }
  }

  async publishObjectFile(
    sourcePath: string,
    contentId: string,
    expectedByteLength: number,
    operation: string,
  ): Promise<string | undefined> {
    const destinationPath = this.objectPath(contentId);
    const temporaryPath = this.temporaryPath(contentId);
    let destinationCreated = false;
    let failure: unknown;
    try {
      const verified = await this.copyAndHashRegularFile(
        sourcePath,
        temporaryPath,
      );
      if (
        verified.byteLength !== expectedByteLength ||
        `sha256:${verified.digest}` !== contentId
      ) {
        throw new Error('Source media object changed during publication');
      }
      destinationCreated = await this.linkDestination(
        temporaryPath,
        destinationPath,
        contentId,
        operation,
      );
      if (destinationCreated) {
        const publishedAt = new Date();
        await utimes(destinationPath, publishedAt, publishedAt);
      }
      await this.restoreFileMode(destinationPath, contentId, operation);
      await this.syncDirectory(dirname(destinationPath));
    } catch (error) {
      failure = error;
    }
    const cleanupFailure = await this.cleanupTemporaryFile(
      undefined,
      temporaryPath,
      destinationPath,
      destinationCreated,
      failure,
    );
    this.throwPublishFailure(failure, cleanupFailure, operation, contentId);
    return destinationCreated ? destinationPath : undefined;
  }

  private async copyAndHashRegularFile(
    sourcePath: string,
    temporaryPath: string,
  ): Promise<FileCopyResult> {
    const source = await open(
      sourcePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let destination: Awaited<ReturnType<typeof open>> | undefined;
    let failure: unknown;
    const hash = createHash('sha256');
    let byteLength = 0;
    try {
      const sourceMetadata = await source.stat();
      if (!sourceMetadata.isFile()) {
        throw new Error('Source media object is not a regular file');
      }
      destination = await open(temporaryPath, 'wx', FILE_MODE);
      const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
      let reading = true;
      while (reading) {
        const { bytesRead } = await source.read(
          buffer,
          0,
          buffer.byteLength,
          null,
        );
        reading = bytesRead !== 0;
        if (reading) {
          hash.update(buffer.subarray(0, bytesRead));
          await this.writeComplete(destination, buffer.subarray(0, bytesRead));
          byteLength += bytesRead;
        }
      }
      await destination.sync();
    } catch (error) {
      failure = error;
    }
    const closeFailures = await this.closeHandles([destination, source]);
    if (failure !== undefined || closeFailures.length > 0) {
      if (closeFailures.length === 0) throw failure;
      const failures =
        failure === undefined ? closeFailures : [failure, ...closeFailures];
      throw new AggregateError(failures);
    }
    return { digest: hash.digest('hex'), byteLength };
  }

  private async writeComplete(
    handle: Awaited<ReturnType<typeof open>>,
    bytes: Uint8Array,
  ): Promise<void> {
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesWritten } = await handle.write(
        bytes,
        offset,
        bytes.byteLength - offset,
      );
      if (bytesWritten === 0) {
        throw new Error('Temporary media write made no progress');
      }
      offset += bytesWritten;
    }
  }

  private async closeHandles(
    handles: ReadonlyArray<Awaited<ReturnType<typeof open>> | undefined>,
  ): Promise<unknown[]> {
    const failures: unknown[] = [];
    for (const handle of handles) {
      if (handle === undefined) continue;
      try {
        await handle.close();
      } catch (error) {
        failures.push(error);
      }
    }
    return failures;
  }

  async replacePublishedBytes(
    bytes: Uint8Array,
    destinationPath: string,
    contentId: string,
    operation: string,
  ): Promise<void> {
    const directory = dirname(destinationPath);
    const temporaryPath = join(directory, `.${randomUUID()}.replacement`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let failure: unknown;
    try {
      handle = await open(temporaryPath, 'wx', FILE_MODE);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await (this.fileOperations.rename ?? rename)(
        temporaryPath,
        destinationPath,
      );
      await this.restoreFileMode(destinationPath, contentId, operation);
      await this.syncDirectory(directory);
    } catch (error) {
      failure = error;
    }
    const cleanupFailure = await this.cleanupReplacement(handle, temporaryPath);
    this.throwPublishFailure(failure, cleanupFailure, operation, contentId);
  }

  private async cleanupReplacement(
    handle: Awaited<ReturnType<typeof open>> | undefined,
    temporaryPath: string,
  ): Promise<unknown> {
    const failures: unknown[] = [];
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (!hasErrnoCode(error, 'ENOENT')) failures.push(error);
    }
    if (failures.length === 0) return undefined;
    return failures.length === 1 ? failures[0] : new AggregateError(failures);
  }

  async rollbackPublishedPaths(paths: readonly string[]): Promise<unknown[]> {
    const cleanupErrors: unknown[] = [];
    for (const path of paths) {
      const cleanupError = await this.removePublishedPath(path);
      if (cleanupError !== undefined) cleanupErrors.push(cleanupError);
    }
    return cleanupErrors;
  }

  private temporaryPath(contentId: string): string {
    return join(
      this.temporaryDirectory,
      `${digestFor(contentId)}.${randomUUID()}.tmp`,
    );
  }

  private async publishBytes(
    bytes: Uint8Array,
    destinationPath: string,
    contentId: string,
    operation: string,
  ): Promise<boolean> {
    const temporaryPath = this.temporaryPath(contentId);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let failure: unknown;
    let destinationCreated = false;
    try {
      handle = await open(temporaryPath, 'wx', FILE_MODE);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      destinationCreated = await this.linkDestination(
        temporaryPath,
        destinationPath,
        contentId,
        operation,
      );
      if (destinationCreated) {
        const publishedAt = new Date();
        await utimes(destinationPath, publishedAt, publishedAt);
      }
      await this.restoreFileMode(destinationPath, contentId, operation);
      await this.syncDirectory(dirname(destinationPath));
    } catch (error) {
      failure = error;
    }
    const cleanupFailure = await this.cleanupTemporaryFile(
      handle,
      temporaryPath,
      destinationPath,
      destinationCreated,
      failure,
    );
    this.throwPublishFailure(failure, cleanupFailure, operation, contentId);
    return destinationCreated;
  }

  private async linkDestination(
    temporaryPath: string,
    destinationPath: string,
    contentId: string,
    operation: string,
  ): Promise<boolean> {
    try {
      await this.fileOperations.link(temporaryPath, destinationPath);
      return true;
    } catch (error) {
      if (!hasErrnoCode(error, 'EEXIST')) {
        const rollbackFailure = await this.rollbackLinkedDestination(
          temporaryPath,
          destinationPath,
        );
        if (rollbackFailure !== undefined) {
          throw new AggregateError([error, rollbackFailure]);
        }
        throw error;
      }
      await this.verifyRegularPath(destinationPath, contentId, operation);
      return false;
    }
  }

  private async rollbackLinkedDestination(
    temporaryPath: string,
    destinationPath: string,
  ): Promise<unknown | undefined> {
    try {
      const [temporary, destination] = await Promise.all([
        lstat(temporaryPath),
        lstat(destinationPath),
      ]);
      if (
        temporary.dev === destination.dev &&
        temporary.ino === destination.ino
      ) {
        await unlink(destinationPath);
      }
      return undefined;
    } catch (error) {
      return hasErrnoCode(error, 'ENOENT') ? undefined : error;
    }
  }

  private async verifyRegularPath(
    path: string,
    contentId: string,
    operation: string,
  ): Promise<void> {
    try {
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) {
        throw new MediaObjectCorruptError(
          operation,
          contentId,
          new Error(
            'Media publication destination must not be a symbolic link',
          ),
        );
      }
      if (!metadata.isFile()) {
        throw new MediaObjectCorruptError(
          operation,
          contentId,
          new Error('Media publication destination is not a regular file'),
        );
      }
    } catch (error) {
      throw wrapError(operation, contentId, error);
    }
  }

  private async cleanupTemporaryFile(
    handle: Awaited<ReturnType<typeof open>> | undefined,
    temporaryPath: string,
    destinationPath: string,
    destinationCreated: boolean,
    failure: unknown,
  ): Promise<unknown> {
    const failures: unknown[] = [];
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (!hasErrnoCode(error, 'ENOENT')) failures.push(error);
    }
    if (failure !== undefined && destinationCreated) {
      try {
        await unlink(destinationPath);
        await this.syncDirectory(dirname(destinationPath));
      } catch (error) {
        if (!hasErrnoCode(error, 'ENOENT')) failures.push(error);
      }
    }
    if (failures.length === 0) return undefined;
    return failures.length === 1 ? failures[0] : new AggregateError(failures);
  }

  private throwPublishFailure(
    failure: unknown,
    cleanupFailure: unknown,
    operation: string,
    contentId: string,
  ): void {
    if (failure !== undefined && cleanupFailure !== undefined) {
      throw new MediaStoreError(
        `${operation} and cleanup temporary file`,
        contentId,
        new AggregateError([failure, cleanupFailure]),
      );
    }
    if (cleanupFailure !== undefined) {
      throw new MediaStoreError(
        `cleanup temporary file after ${operation}`,
        contentId,
        cleanupFailure,
      );
    }
    if (failure !== undefined) throw wrapError(operation, contentId, failure);
  }

  private async removePublishedPath(path: string): Promise<unknown> {
    try {
      await unlink(path);
      return undefined;
    } catch (error) {
      return hasErrnoCode(error, 'ENOENT') ? undefined : error;
    }
  }

  private async restoreFileMode(
    path: string,
    contentId: string,
    operation: string,
  ): Promise<void> {
    await this.verifyRegularPath(path, contentId, operation);
    if (process.platform === 'win32') return;
    try {
      await chmod(path, FILE_MODE);
      const metadata = await lstat(path);
      if (
        metadata.isSymbolicLink() ||
        !metadata.isFile() ||
        (metadata.mode & 0o777) !== FILE_MODE
      ) {
        throw new Error('Media object permissions were not restored');
      }
    } catch (error) {
      throw wrapError(operation, contentId, error);
    }
  }
}
