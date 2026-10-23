/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertNotNull } from '@vybestack/llxprt-code-test-utils';
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IContent,
  MediaReferenceBlock,
  MediaStoredObject,
} from '../services/history/IContent.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import {
  createPackageRecorder,
  packageRecordingName,
  writePackageRecording,
} from './__tests__/support/packageRecording.js';

import { readPackageRows } from './__tests__/support/packageRecording.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { readJournalCheckpoints } from './journalSessionListing.js';
import { MAX_PERSISTED_STATE_BYTES } from './session-media-package-validation.js';
import {
  exportSessionMediaPackage,
  importSessionMediaPackage,
  validateSessionMediaPackage,
} from './session-media-package.js';

const PROJECT_HASH = 'package-bounds-project';

function storedObject(
  bytes: Uint8Array,
  mimeType = 'application/octet-stream',
): MediaStoredObject {
  return {
    contentId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    mimeType,
    byteLength: bytes.byteLength,
    normalizedBase64Length: Math.ceil(bytes.byteLength / 3) * 4,
  };
}

function referenceFor(object: MediaStoredObject): MediaReferenceBlock {
  return {
    type: 'media',
    encoding: 'reference',
    mimeType: object.mimeType,
    contentId: object.contentId,
    originalContentId: object.contentId,
    selectedContentId: object.contentId,
    originalObject: object,
    selectedObject: object,
    transformation: {
      policyId: 'identity',
      policyVersion: 1,
      parameters: {},
    },
    byteLength: object.byteLength,
    normalizedBase64Length: object.normalizedBase64Length,
    ...(object.dimensions === undefined
      ? {}
      : { dimensions: object.dimensions }),
    semanticMetadata: {},
  };
}

function history(reference: MediaReferenceBlock): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [reference],
      metadata: { turnId: 'package-bounds-turn' },
    },
  ];
}

async function writePackage(
  root: string,
  manifestReference: MediaReferenceBlock,
  recordingReference: MediaReferenceBlock = manifestReference,
  persistedHistory: readonly IContent[] = [],
): Promise<string> {
  const packageDirectory = join(root, crypto.randomUUID());
  const object = manifestReference.selectedObject;
  await mkdir(join(packageDirectory, 'blobs', 'sha256'), { recursive: true });
  await writeFile(
    join(
      packageDirectory,
      'blobs',
      'sha256',
      object.contentId.slice('sha256:'.length),
    ),
    Buffer.from([1, 2, 3]),
  );
  const sessionId = 'bounded-package-session';
  await writePackageRecording(
    packageDirectory,
    [history(recordingReference)],
    PROJECT_HASH,
  );
  const persistedStates =
    persistedHistory.length === 0
      ? []
      : [{ file: 'state/persisted-0.json', version: 1 }];
  if (persistedHistory.length > 0) {
    await mkdir(join(packageDirectory, 'state'));
    await writeFile(
      join(packageDirectory, 'state', 'persisted-0.json'),
      JSON.stringify({
        version: 1,
        sessionId,
        projectHash: PROJECT_HASH,
        history: persistedHistory,
      }),
    );
  }
  await writeFile(
    join(packageDirectory, 'manifest.json'),
    JSON.stringify({
      version: 2,
      recording: packageRecordingName(),
      persistedStates,
      references: [manifestReference],
      objects: [object],
    }),
  );
  return packageDirectory;
}

type SidecarKind = 'count' | 'bytes';

async function writeLegacySidecars(
  chats: string,
  kind: SidecarKind,
): Promise<void> {
  for (let index = 0; index < (kind === 'count' ? 257 : 6); index += 1) {
    const file = await open(
      join(chats, `persisted-session-${index}.json`),
      'wx',
    );
    try {
      if (kind === 'count') await file.writeFile('{');
      else
        await file.truncate(MAX_PERSISTED_STATE_BYTES + (index === 0 ? 1 : 0));
    } finally {
      await file.close();
    }
  }
}

describe('session media package bounded validation', () => {
  let tempDirectory = '';

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'llxprt-package-bounds-'));
  });
  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('rejects duplicate manifest objects before publication', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const reference = referenceFor(storedObject(bytes));
    const packageDirectory = await writePackage(tempDirectory, reference);
    const manifestPath = join(packageDirectory, 'manifest.json');
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('objects' in parsed)
    ) {
      throw new Error('Expected package manifest');
    }
    if (!Array.isArray(parsed.objects)) throw new Error('Expected objects');
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...parsed,
        objects: [...parsed.objects, ...parsed.objects],
      }),
    );

    await expect(validateSessionMediaPackage(packageDirectory)).rejects.toThrow(
      /duplicate.*object/i,
    );
  });

  it('rejects recording object metadata that differs from the manifest', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const manifestReference = referenceFor(storedObject(bytes, 'image/png'));
    const recordingReference = referenceFor(
      storedObject(bytes, 'application/octet-stream'),
    );
    const packageDirectory = await writePackage(
      tempDirectory,
      manifestReference,
      recordingReference,
    );

    await expect(validateSessionMediaPackage(packageDirectory)).rejects.toThrow(
      /recording.*metadata/i,
    );
  });

  it('rejects persisted history references absent from the manifest', async () => {
    const manifestReference = referenceFor(
      storedObject(new Uint8Array([1, 2, 3])),
    );
    const undeclaredReference = referenceFor(
      storedObject(new Uint8Array([4, 5, 6])),
    );
    const packageDirectory = await writePackage(
      tempDirectory,
      manifestReference,
      manifestReference,
      history(undeclaredReference),
    );

    await expect(validateSessionMediaPackage(packageDirectory)).rejects.toThrow(
      /persisted.*undeclared/i,
    );
  });

  it('rejects a blob whose filesystem size differs from declared metadata before hashing', async () => {
    const reference = referenceFor(storedObject(new Uint8Array([1, 2, 3])));
    const packageDirectory = await writePackage(tempDirectory, reference);
    await writeFile(
      join(
        packageDirectory,
        'blobs',
        'sha256',
        reference.contentId.slice('sha256:'.length),
      ),
      Buffer.alloc(1024 * 1024, 7),
    );

    await expect(validateSessionMediaPackage(packageDirectory)).rejects.toThrow(
      /blob size.*declared/i,
    );
  });

  it('rejects same-length blob corruption after hashing the complete blob', async () => {
    const reference = referenceFor(storedObject(new Uint8Array([1, 2, 3])));
    const packageDirectory = await writePackage(tempDirectory, reference);
    await writeFile(
      join(
        packageDirectory,
        'blobs',
        'sha256',
        reference.contentId.slice('sha256:'.length),
      ),
      Buffer.from([3, 2, 1]),
    );

    await expect(validateSessionMediaPackage(packageDirectory)).rejects.toThrow(
      /blob is corrupt/i,
    );
  });

  it('rejects a missing package blob before publication', async () => {
    const reference = referenceFor(storedObject(new Uint8Array([1, 2, 3])));
    const packageDirectory = await writePackage(tempDirectory, reference);
    await rm(
      join(
        packageDirectory,
        'blobs',
        'sha256',
        reference.contentId.slice('sha256:'.length),
      ),
    );

    await expect(validateSessionMediaPackage(packageDirectory)).rejects.toThrow(
      /blob is missing/i,
    );
  });

  it('compares image dimensions structurally regardless of property insertion order', async () => {
    const object: MediaStoredObject = {
      ...storedObject(new Uint8Array([1, 2, 3]), 'image/png'),
      dimensions: { width: 1, height: 1 },
    };
    const recordingObject: MediaStoredObject = {
      ...object,
      dimensions: { height: 1, width: 1 },
    };
    const packageDirectory = await writePackage(
      tempDirectory,
      referenceFor(object),
      referenceFor(recordingObject),
    );

    const validated = await validateSessionMediaPackage(packageDirectory);
    expect(validated.packageDirectory).toBe(packageDirectory);
  });

  it('bounds export persisted states by count before reading their contents', async () => {
    const chatsDirectory = join(tempDirectory, 'state-count-chats');
    const store = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'state-count-media'),
      quotaBytes: 1024,
    });
    const recording = createPackageRecorder({
      sessionId: 'state-count-session',
      projectHash: PROJECT_HASH,
      chatsDir: chatsDirectory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: store,
    });
    try {
      await recordRowsForTest(recording, [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'bounded state source' }],
        },
      ]);
      await recording.flush();
      const recordingPath = recording.getFilePath();
      assertNotNull(recordingPath, 'Expected recording path');
      for (let index = 0; index < 257; index += 1) {
        await writeFile(
          join(chatsDirectory, `persisted-session-${index}.json`),
          '{',
        );
      }

      await expect(
        exportSessionMediaPackage(
          recordingPath,
          PROJECT_HASH,
          store,
          join(tempDirectory, 'state-count-package'),
        ),
      ).rejects.toThrow(/persisted state count exceeds limit/i);
    } finally {
      await recording.dispose();
    }
  });

  it('bounds each export persisted state and aggregate bytes before materialization', async () => {
    const chatsDirectory = join(tempDirectory, 'state-bytes-chats');
    const store = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'state-bytes-media'),
      quotaBytes: 1024,
    });
    const recording = createPackageRecorder({
      sessionId: 'state-bytes-session',
      projectHash: PROJECT_HASH,
      chatsDir: chatsDirectory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: store,
    });
    try {
      await recordRowsForTest(recording, [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'bounded state bytes' }],
        },
      ]);
      await recording.flush();
      const recordingPath = recording.getFilePath();
      assertNotNull(recordingPath, 'Expected recording path');
      const oversizedPath = join(
        chatsDirectory,
        'persisted-session-oversized.json',
      );
      const oversized = await open(oversizedPath, 'wx');
      try {
        await oversized.truncate(MAX_PERSISTED_STATE_BYTES + 1);
      } finally {
        await oversized.close();
      }
      await expect(
        exportSessionMediaPackage(
          recordingPath,
          PROJECT_HASH,
          store,
          join(tempDirectory, 'state-oversized-package'),
        ),
      ).rejects.toThrow(/persisted session state exceeds finite byte limit/i);
      await rm(oversizedPath);
      for (let index = 0; index < 5; index += 1) {
        const aggregatePath = join(
          chatsDirectory,
          `persisted-session-aggregate-${index}.json`,
        );
        const aggregate = await open(aggregatePath, 'wx');
        try {
          await aggregate.truncate(MAX_PERSISTED_STATE_BYTES);
        } finally {
          await aggregate.close();
        }
      }

      await expect(
        exportSessionMediaPackage(
          recordingPath,
          PROJECT_HASH,
          store,
          join(tempDirectory, 'state-aggregate-package'),
        ),
      ).rejects.toThrow(/persisted session states exceeds finite aggregate/i);
    } finally {
      await recording.dispose();
    }
  });

  const sidecarCases: readonly SidecarKind[] = ['count', 'bytes'];
  for (const kind of sidecarCases) {
    it(`exports native checkpoint state without reading legacy sidecars exceeding ${kind} bounds`, async () => {
      const chats = join(tempDirectory, 'native-chats');
      const media = new LocalMediaStore({
        rootDirectory: join(tempDirectory, 'native-media'),
        quotaBytes: 1024,
      });
      const recorder = createPackageRecorder({
        chatsDir: chats,
        projectHash: PROJECT_HASH,
      });
      if (!(recorder instanceof JournalRecordingService))
        throw new Error('Expected native recorder');
      const rows: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'bounded native state' }],
        },
      ];
      let path: string;
      try {
        await recordRowsForTest(recorder, rows);
        await recorder.createCheckpoint('Saved');
        const recorded = recorder.getFilePath();
        assertNotNull(recorded, 'Expected native path');
        path = recorded;
      } finally {
        await recorder.dispose();
      }
      await writeLegacySidecars(chats, kind);
      const directory = join(tempDirectory, 'native-package');
      await exportSessionMediaPackage(path, PROJECT_HASH, media, directory);
      const validated = await validateSessionMediaPackage(directory);
      expect(validated.manifest.persistedStates).toStrictEqual([]);
      const imported = await importSessionMediaPackage(
        validated,
        join(tempDirectory, 'import-chats'),
        PROJECT_HASH,
        media,
      );
      expect(
        (await readPackageRows(imported.recordingPath, PROJECT_HASH)).map(
          (row) => row.blocks,
        ),
      ).toStrictEqual(rows.map((row) => row.blocks));
      expect(
        (await readJournalCheckpoints(imported.recordingPath)).map(
          (point) => point.name,
        ),
      ).toStrictEqual(['Saved']);
    });
  }

  it('releases temporary export owners after successful publication', async () => {
    const store = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'media'),
      quotaBytes: 1024,
    });
    const reference = await store.admit({
      bytes: new Uint8Array([9, 8, 7]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const recording = createPackageRecorder({
      sessionId: 'owner-release-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: store,
    });
    try {
      await recordRowsForTest(recording, [history(reference)[0]]);
      await recording.flush();
      const recordingPath = recording.getFilePath();
      assertNotNull(recordingPath, 'Expected recording path');
      await exportSessionMediaPackage(
        recordingPath,
        PROJECT_HASH,
        store,
        join(tempDirectory, 'package'),
      );
      expect(await store.hasReservations(reference.contentId)).toBe(false);
    } finally {
      await recording.dispose();
    }
  });
});
