/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { Mock } from 'bun:test';
import type { Storage } from '@google-cloud/storage';
import type { Task as SDKTask } from '@a2a-js/sdk';
import type { TaskStore } from '@a2a-js/sdk/server';

import { GCSTaskStore, NoOpTaskStore } from './gcs.js';
import { METADATA_KEY } from '../types.js';
const mockPathExists = vi.fn();
const mockRemove = vi.fn();
const mockEnsureDir = vi.fn();
const mockReaddir = vi.fn();
const mockCreateReadStream = vi.fn();
const mockCreateArchive = vi.fn();
const mockExtractArchive = vi.fn();
const mockGzip = vi.fn();
const mockGunzip = vi.fn();
const mockCreateId = vi.fn();
const mockJoinPath = vi.fn(
  (directory: string, filename: string) => `${directory}/${filename}`,
);
const mockSetTargetDir = vi.fn();
const mockGetPersistedState = vi.fn();

type MockWriteStream = {
  emit: Mock<(event: string, ...args: unknown[]) => boolean>;
  removeListener: Mock<
    (event: string, cb: (error?: Error | null) => void) => MockWriteStream
  >;
  once: Mock<
    (event: string, cb: (error?: Error | null) => void) => MockWriteStream
  >;
  on: Mock<
    (event: string, cb: (error?: Error | null) => void) => MockWriteStream
  >;
  destroy: Mock<() => void>;
  write: Mock<(chunk: unknown, encoding?: unknown, cb?: unknown) => boolean>;
  end: Mock<(cb?: unknown) => void>;
  destroyed: boolean;
};

type MockFile = {
  save: Mock<(data: Buffer | string) => Promise<void>>;
  download: Mock<() => Promise<[Buffer]>>;
  exists: Mock<() => Promise<[boolean]>>;
  createWriteStream: Mock<() => MockWriteStream>;
};

type MockBucket = {
  exists: Mock<() => Promise<[boolean]>>;
  file: Mock<(path: string) => MockFile>;
  name: string;
};

type MockStorageInstance = {
  bucket: Mock<(name: string) => MockBucket>;
  getBuckets: Mock<() => Promise<[Array<{ name: string }>]>>;
  createBucket: Mock<(name: string) => Promise<[MockBucket]>>;
};

async function expectRejection(
  promise: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toContain(expectedMessage);
    }
    return;
  }

  throw new Error('Expected promise to reject');
}

describe('GCSTaskStore', () => {
  let bucketName: string;
  let mockBucket: MockBucket;
  let mockFile: MockFile;
  let mockWriteStream: MockWriteStream;
  let mockStorageInstance: MockStorageInstance;

  const createStore = () =>
    new GCSTaskStore(bucketName, {
      storage: mockStorageInstance as unknown as Storage,
      gzip: mockGzip,
      gunzip: mockGunzip,
      createArchive: mockCreateArchive,
      extractArchive: mockExtractArchive,
      pathExists: mockPathExists,
      remove: mockRemove,
      ensureDir: mockEnsureDir,
      readdir: mockReaddir,
      createReadStream: mockCreateReadStream,
      getTmpDir: () => '/tmp',
      joinPath: mockJoinPath,
      createId: mockCreateId,
      setTargetDir: mockSetTargetDir,
      getPersistedState: mockGetPersistedState,
    });
  beforeEach(() => {
    vi.clearAllMocks();
    bucketName = 'test-bucket';

    mockWriteStream = {
      emit: vi.fn().mockReturnValue(true),
      removeListener: vi.fn(() => mockWriteStream),
      on: vi.fn((event, cb) => {
        if (event === 'finish') setTimeout(cb, 0); // Simulate async finish
        return mockWriteStream;
      }),
      once: vi.fn((event, cb) => {
        if (event === 'finish') setTimeout(cb, 0); // Simulate async finish
        return mockWriteStream;
      }),
      destroy: vi.fn(),
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
      destroyed: false,
    };

    mockFile = {
      save: vi.fn().mockResolvedValue(undefined),
      download: vi.fn().mockResolvedValue([Buffer.from('')]),
      exists: vi.fn().mockResolvedValue([true]),
      createWriteStream: vi.fn().mockReturnValue(mockWriteStream),
    };

    mockBucket = {
      exists: vi.fn().mockResolvedValue([true]),
      file: vi.fn().mockReturnValue(mockFile),
      name: bucketName,
    };

    mockStorageInstance = {
      bucket: vi.fn().mockReturnValue(mockBucket),
      getBuckets: vi.fn().mockResolvedValue([[{ name: bucketName }]]),
      createBucket: vi.fn().mockResolvedValue([mockBucket]),
    };
    mockCreateId.mockReturnValue('test-uuid');
    mockSetTargetDir.mockReturnValue('/tmp/workdir');
    mockGetPersistedState.mockReturnValue({
      _agentSettings: {},
      _taskState: 'submitted',
    });
    mockPathExists.mockResolvedValue(true);
    mockReaddir.mockResolvedValue(['file1.txt']);
    mockCreateArchive.mockResolvedValue(undefined);
    mockExtractArchive.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
    mockEnsureDir.mockResolvedValue(undefined);
    mockGzip.mockReturnValue(Buffer.from('compressed'));
    mockGunzip.mockReturnValue(Buffer.from('{}'));
    mockCreateReadStream.mockReturnValue({ on: vi.fn(), pipe: vi.fn() });
  });

  describe('Constructor & Initialization', () => {
    it('should initialize and check bucket existence', async () => {
      const store = createStore();
      await store['ensureBucketInitialized']();
      expect(mockStorageInstance.getBuckets).toHaveBeenCalledTimes(1);
    });

    it('should create bucket if it does not exist', async () => {
      mockStorageInstance.getBuckets.mockResolvedValue([[]]);
      const store = createStore();
      await store['ensureBucketInitialized']();
      expect(mockStorageInstance.createBucket).toHaveBeenCalledWith(bucketName);
    });

    it('should throw if bucket creation fails', async () => {
      mockStorageInstance.getBuckets.mockResolvedValue([[]]);
      mockStorageInstance.createBucket.mockRejectedValue(
        new Error('Create failed'),
      );
      const store = createStore();
      await expectRejection(
        store['ensureBucketInitialized'](),
        'Failed to create GCS bucket test-bucket: Error: Create failed',
      );
    });
  });

  describe('save', () => {
    const mockTask: SDKTask = {
      id: 'task1',
      contextId: 'ctx1',
      kind: 'task',
      status: { state: 'working' },
      metadata: {},
    };

    it('should save metadata and workspace', async () => {
      const store = createStore();
      await store.save(mockTask);

      expect(mockFile.save).toHaveBeenCalledTimes(1);
      expect(mockJoinPath).toHaveBeenCalledWith(
        '/tmp',
        'task-task1-workspace-test-uuid.tar.gz',
      );
      expect(mockCreateArchive).toHaveBeenCalledTimes(1);
      expect(mockRemove).toHaveBeenCalledTimes(1);
    });

    it('should handle tar creation failure', async () => {
      mockPathExists.mockImplementation(
        (path: string) =>
          !path.includes('task-task1-workspace-test-uuid.tar.gz'),
      );
      const store = createStore();
      await expectRejection(
        store.save(mockTask),
        'tar.c command failed to create',
      );
    });

    it('should throw an error if taskId contains path traversal sequences', async () => {
      const store = createStore();
      const maliciousTask: SDKTask = {
        id: '../../../malicious-task',
        metadata: {
          _internal: {
            agentSettings: {
              cacheDir: '/tmp/cache',
              dataDir: '/tmp/data',
              logDir: '/tmp/logs',
              tempDir: '/tmp/temp',
            },
            taskState: 'working',
          },
        },
        kind: 'task',
        status: {
          state: 'working',
          timestamp: new Date().toISOString(),
        },
        contextId: 'test-context',
        history: [],
        artifacts: [],
      };
      await expectRejection(
        store.save(maliciousTask),
        'Invalid taskId: ../../../malicious-task',
      );
    });
  });

  describe('load', () => {
    it('should load task metadata and workspace', async () => {
      mockGunzip.mockReturnValue(
        Buffer.from(
          JSON.stringify({
            [METADATA_KEY]: {
              _agentSettings: {},
              _taskState: 'submitted',
            },
            _contextId: 'ctx1',
          }),
        ),
      );
      mockBucket.file = vi.fn((path) => {
        const newMockFile = { ...mockFile };
        if (path.includes('metadata')) {
          newMockFile.download = vi
            .fn()
            .mockResolvedValue([Buffer.from('compressed metadata')]);
          newMockFile.exists = vi.fn().mockResolvedValue([true]);
        } else {
          newMockFile.download = vi
            .fn()
            .mockResolvedValue([Buffer.from('compressed workspace')]);
          newMockFile.exists = vi.fn().mockResolvedValue([true]);
        }
        return newMockFile;
      });

      const store = createStore();
      const task = await store.load('task1');

      expect(task).toBeDefined();
      expect(task?.id).toBe('task1');
      expect(mockBucket.file).toHaveBeenCalledWith(
        'tasks/task1/metadata.tar.gz',
      );
      expect(mockBucket.file).toHaveBeenCalledWith(
        'tasks/task1/workspace.tar.gz',
      );
      expect(mockExtractArchive).toHaveBeenCalledTimes(1);
      expect(mockRemove).toHaveBeenCalledTimes(1);
    });

    it('should return undefined if metadata not found', async () => {
      mockFile.exists.mockResolvedValue([false]);
      const store = createStore();
      const task = await store.load('task1');
      expect(task).toBeUndefined();
      expect(mockBucket.file).toHaveBeenCalledWith(
        'tasks/task1/metadata.tar.gz',
      );
    });

    it('should load metadata even if workspace not found', async () => {
      mockGunzip.mockReturnValue(
        Buffer.from(
          JSON.stringify({
            [METADATA_KEY]: {
              _agentSettings: {},
              _taskState: 'submitted',
            },
            _contextId: 'ctx1',
          }),
        ),
      );

      mockBucket.file = vi.fn((path) => {
        const newMockFile = { ...mockFile };
        if (path.includes('workspace.tar.gz')) {
          newMockFile.exists = vi.fn().mockResolvedValue([false]);
        } else {
          newMockFile.exists = vi.fn().mockResolvedValue([true]);
          newMockFile.download = vi
            .fn()
            .mockResolvedValue([Buffer.from('compressed metadata')]);
        }
        return newMockFile;
      });

      const store = createStore();
      const task = await store.load('task1');

      expect(task).toBeDefined();
      expect(mockExtractArchive).not.toHaveBeenCalled();
    });
  });

  it('should throw an error if taskId contains path traversal sequences', async () => {
    const store = createStore();
    const maliciousTaskId = '../../../malicious-task';
    await expectRejection(
      store.load(maliciousTaskId),
      `Invalid taskId: ${maliciousTaskId}`,
    );
  });
});

describe('NoOpTaskStore', () => {
  let realStore: TaskStore;
  let noOpStore: NoOpTaskStore;

  beforeEach(() => {
    // Create a mock of the real store to delegate to
    realStore = {
      save: vi.fn(),
      load: vi.fn().mockResolvedValue({ id: 'task-123' } as SDKTask),
    };
    noOpStore = new NoOpTaskStore(realStore);
  });

  it("should not call the real store's save method", async () => {
    const mockTask: SDKTask = { id: 'test-task' } as SDKTask;
    await noOpStore.save(mockTask);
    expect(realStore.save).not.toHaveBeenCalled();
  });

  it('should delegate the load method to the real store', async () => {
    const taskId = 'task-123';
    const result = await noOpStore.load(taskId);
    expect(realStore.load).toHaveBeenCalledWith(taskId);
    expect(result).toBeDefined();
    expect(result?.id).toBe(taskId);
  });
});
