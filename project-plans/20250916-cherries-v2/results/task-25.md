# Task 25 Results

## Commits Picked / Ported
- `50b5c430` — chore(a2a-server): Merge A2A types (#7650) → `ec57caf58` — Package import automatically adapted from `@google/gemini-cli-core` to `@vybestack/llxprt-code-core`

## Original Diffs
```diff
commit 50b5c4303e8a7c2e24e3194255237f09c474d805
Author: Adam Weidman <65992621+adamfweidman@users.noreply.github.com>
Date:   Wed Sep 3 16:19:15 2025 +0000

    chore(a2a-server): Merge A2A types (#7650)

diff --git a/packages/a2a-server/src/agent/executor.ts b/packages/a2a-server/src/agent/executor.ts
index 8ce8250f0..302224cbf 100644
--- a/packages/a2a-server/src/agent/executor.ts
+++ b/packages/a2a-server/src/agent/executor.ts
@@ -19,15 +19,22 @@ import type {
 } from '@google/gemini-cli-core';
 import { GeminiEventType } from '@google/gemini-cli-core';
 import { v4 as uuidv4 } from 'uuid';
+
 import { logger } from '../utils/logger.js';
-import type { StateChange, AgentSettings } from '../types.js';
-import { CoderAgentEvent } from '../types.js';
+import type {
+  StateChange,
+  AgentSettings,
+  PersistedStateMetadata,
+} from '../types.js';
+import {
+  CoderAgentEvent,
+  getPersistedState,
+  setPersistedState,
+} from '../types.js';
 import { loadConfig, loadEnvironment, setTargetDir } from '../config/config.js';
 import { loadSettings } from '../config/settings.js';
 import { loadExtensions } from '../config/extension.js';
 import { Task } from './task.js';
-import type { PersistedStateMetadata } from '../metadata_types.js';
-import { getPersistedState, setPersistedState } from '../metadata_types.js';
 import { requestStorage } from '../http/requestStorage.js';
 
 /**
diff --git a/packages/a2a-server/src/metadata_types.ts b/packages/a2a-server/src/metadata_types.ts
deleted file mode 100644
index 4e3383826..000000000
--- a/packages/a2a-server/src/metadata_types.ts
+++ /dev/null
@@ -1,33 +0,0 @@
-/**
- * @license
- * Copyright 2025 Google LLC
- * SPDX-License-Identifier: Apache-2.0
- */
-
-import type { AgentSettings } from './types.js';
-import type { TaskState } from '@a2a-js/sdk';
-
-export interface PersistedStateMetadata {
-  _agentSettings: AgentSettings;
-  _taskState: TaskState;
-}
-
-export type PersistedTaskMetadata = { [k: string]: unknown };
-
-export const METADATA_KEY = '__persistedState';
-
-export function getPersistedState(
-  metadata: PersistedTaskMetadata,
-): PersistedStateMetadata | undefined {
-  return metadata?.[METADATA_KEY] as PersistedStateMetadata | undefined;
-}
-
-export function setPersistedState(
-  metadata: PersistedTaskMetadata,
-  state: PersistedStateMetadata,
-): PersistedTaskMetadata {
-  return {
-    ...metadata,
-    [METADATA_KEY]: state,
-  };
-}
diff --git a/packages/a2a-server/src/persistence/gcs.test.ts b/packages/a2a-server/src/persistence/gcs.test.ts
index 163fd83d0..216e7d578 100644
--- a/packages/a2a-server/src/persistence/gcs.test.ts
+++ b/packages/a2a-server/src/persistence/gcs.test.ts
@@ -18,7 +18,7 @@ import { describe, it, expect, beforeEach, vi } from 'vitest';
 import { GCSTaskStore, NoOpTaskStore } from './gcs.js';
 import { logger } from '../utils/logger.js';
 import * as configModule from '../config/config.js';
-import * as metadataModule from '../metadata_types.js';
+import { getPersistedState, METADATA_KEY } from '../types.js';
 
 // Mock dependencies
 vi.mock('@google-cloud/storage');
@@ -53,10 +53,16 @@ vi.mock('../utils/logger.js', () => ({
 vi.mock('../config/config.js', () => ({
   setTargetDir: vi.fn(),
 }));
-vi.mock('../metadata_types');
 vi.mock('node:stream/promises', () => ({
   pipeline: vi.fn(),
 }));
+vi.mock('../types.js', async (importOriginal) => {
+  const actual = await importOriginal<typeof import('../types.js')>();
+  return {
+    ...actual,
+    getPersistedState: vi.fn(),
+  };
+});
 
 const mockStorage = Storage as MockedClass<typeof Storage>;
 const mockFse = fse as Mocked<typeof fse>;
@@ -66,8 +72,8 @@ const mockGzipSync = gzipSync as Mock;
 const mockGunzipSync = gunzipSync as Mock;
 const mockUuidv4 = uuidv4 as Mock;
 const mockSetTargetDir = configModule.setTargetDir as Mock;
-const mockGetPersistedState = metadataModule.getPersistedState as Mock;
-const METADATA_KEY = metadataModule.METADATA_KEY || '__persistedState';
+const mockGetPersistedState = getPersistedState as Mock;
+const TEST_METADATA_KEY = METADATA_KEY || '__persistedState';
 
 type MockWriteStream = {
   on: Mock<
@@ -228,7 +234,10 @@ describe('GCSTaskStore', () => {
       mockGunzipSync.mockReturnValue(
         Buffer.from(
           JSON.stringify({
-            [METADATA_KEY]: { _agentSettings: {}, _taskState: 'submitted' },
+            [TEST_METADATA_KEY]: {
+              _agentSettings: {},
+              _taskState: 'submitted',
+            },
             _contextId: 'ctx1',
           }),
         ),
@@ -282,7 +291,10 @@ describe('GCSTaskStore', () => {
       mockGunzipSync.mockReturnValue(
         Buffer.from(
           JSON.stringify({
-            [METADATA_KEY]: { _agentSettings: {}, _taskState: 'submitted' },
+            [TEST_METADATA_KEY]: {
+              _agentSettings: {},
+              _taskState: 'submitted',
+            },
             _contextId: 'ctx1',
           }),
         ),
diff --git a/packages/a2a-server/src/persistence/gcs.ts b/packages/a2a-server/src/persistence/gcs.ts
index 9f80990f4..ef952f49a 100644
--- a/packages/a2a-server/src/persistence/gcs.ts
+++ b/packages/a2a-server/src/persistence/gcs.ts
@@ -15,10 +15,7 @@ import type { Task as SDKTask } from '@a2a-js/sdk';
 import type { TaskStore } from '@a2a-js/sdk/server';
 import { logger } from '../utils/logger.js';
 import { setTargetDir } from '../config/config.js';
-import {
-  getPersistedState,
-  type PersistedTaskMetadata,
-} from '../metadata_types.js';
+import { getPersistedState, type PersistedTaskMetadata } from '../types.js';
 import { v4 as uuidv4 } from 'uuid';
 
 type ObjectType = 'metadata' | 'workspace';
diff --git a/packages/a2a-server/src/types.ts b/packages/a2a-server/src/types.ts
index 5a82059b4..f806af833 100644
--- a/packages/a2a-server/src/types.ts
+++ b/packages/a2a-server/src/types.ts
@@ -102,3 +102,28 @@ export interface TaskMetadata {
     parameterSchema: unknown;
   }>;
 }
+
+export interface PersistedStateMetadata {
+  _agentSettings: AgentSettings;
+  _taskState: TaskState;
+}
+
+export type PersistedTaskMetadata = { [k: string]: unknown };
+
+export const METADATA_KEY = '__persistedState';
+
+export function getPersistedState(
+  metadata: PersistedTaskMetadata,
+): PersistedStateMetadata | undefined {
+  return metadata?.[METADATA_KEY] as PersistedStateMetadata | undefined;
+}
+
+export function setPersistedState(
+  metadata: PersistedTaskMetadata,
+  state: PersistedStateMetadata,
+): PersistedTaskMetadata {
+  return {
+    ...metadata,
+    [METADATA_KEY]: state,
+  };
+}
```

## Our Committed Diffs
```diff
commit ec57caf5827ad0adb728e7a79caf68c878e986c0
Author: Adam Weidman <65992621+adamfweidman@users.noreply.github.com>
Date:   Wed Sep 3 16:19:15 2025 +0000

    chore(a2a-server): Merge A2A types (#7650)
    
    (cherry picked from commit 50b5c4303e8a7c2e24e3194255237f09c474d805)

diff --git a/packages/a2a-server/src/agent/executor.ts b/packages/a2a-server/src/agent/executor.ts
index 764e03ef0..f6aa33ac0 100644
--- a/packages/a2a-server/src/agent/executor.ts
+++ b/packages/a2a-server/src/agent/executor.ts
@@ -19,15 +19,22 @@ import type {
 } from '@vybestack/llxprt-code-core';
 import { GeminiEventType } from '@vybestack/llxprt-code-core';
 import { v4 as uuidv4 } from 'uuid';
+
 import { logger } from '../utils/logger.js';
-import type { StateChange, AgentSettings } from '../types.js';
-import { CoderAgentEvent } from '../types.js';
+import type {
+  StateChange,
+  AgentSettings,
+  PersistedStateMetadata,
+} from '../types.js';
+import {
+  CoderAgentEvent,
+  getPersistedState,
+  setPersistedState,
+} from '../types.js';
 import { loadConfig, loadEnvironment, setTargetDir } from '../config/config.js';
 import { loadSettings } from '../config/settings.js';
 import { loadExtensions } from '../config/extension.js';
 import { Task } from './task.js';
-import type { PersistedStateMetadata } from '../metadata_types.js';
-import { getPersistedState, setPersistedState } from '../metadata_types.js';
 import { requestStorage } from '../http/requestStorage.js';
 
 /**
diff --git a/packages/a2a-server/src/metadata_types.ts b/packages/a2a-server/src/metadata_types.ts
deleted file mode 100644
index 4e3383826..000000000
--- a/packages/a2a-server/src/metadata_types.ts
+++ /dev/null
@@ -1,33 +0,0 @@
-/**
- * @license
- * Copyright 2025 Google LLC
- * SPDX-License-Identifier: Apache-2.0
- */
-
-import type { AgentSettings } from './types.js';
-import type { TaskState } from '@a2a-js/sdk';
-
-export interface PersistedStateMetadata {
-  _agentSettings: AgentSettings;
-  _taskState: TaskState;
-}
-
-export type PersistedTaskMetadata = { [k: string]: unknown };
-
-export const METADATA_KEY = '__persistedState';
-
-export function getPersistedState(
-  metadata: PersistedTaskMetadata,
-): PersistedStateMetadata | undefined {
-  return metadata?.[METADATA_KEY] as PersistedStateMetadata | undefined;
-}
-
-export function setPersistedState(
-  metadata: PersistedTaskMetadata,
-  state: PersistedStateMetadata,
-): PersistedTaskMetadata {
-  return {
-    ...metadata,
-    [METADATA_KEY]: state,
-  };
-}
diff --git a/packages/a2a-server/src/persistence/gcs.test.ts b/packages/a2a-server/src/persistence/gcs.test.ts
index 163fd83d0..216e7d578 100644
--- a/packages/a2a-server/src/persistence/gcs.test.ts
+++ b/packages/a2a-server/src/persistence/gcs.test.ts
@@ -18,7 +18,7 @@ import { describe, it, expect, beforeEach, vi } from 'vitest';
 import { GCSTaskStore, NoOpTaskStore } from './gcs.js';
 import { logger } from '../utils/logger.js';
 import * as configModule from '../config/config.js';
-import * as metadataModule from '../metadata_types.js';
+import { getPersistedState, METADATA_KEY } from '../types.js';
 
 // Mock dependencies
 vi.mock('@google-cloud/storage');
@@ -53,10 +53,16 @@ vi.mock('../utils/logger.js', () => ({
 vi.mock('../config/config.js', () => ({
   setTargetDir: vi.fn(),
 }));
-vi.mock('../metadata_types');
 vi.mock('node:stream/promises', () => ({
   pipeline: vi.fn(),
 }));
+vi.mock('../types.js', async (importOriginal) => {
+  const actual = await importOriginal<typeof import('../types.js')>();
+  return {
+    ...actual,
+    getPersistedState: vi.fn(),
+  };
+});
 
 const mockStorage = Storage as MockedClass<typeof Storage>;
 const mockFse = fse as Mocked<typeof fse>;
@@ -66,8 +72,8 @@ const mockGzipSync = gzipSync as Mock;
 const mockGunzipSync = gunzipSync as Mock;
 const mockUuidv4 = uuidv4 as Mock;
 const mockSetTargetDir = configModule.setTargetDir as Mock;
-const mockGetPersistedState = metadataModule.getPersistedState as Mock;
-const METADATA_KEY = metadataModule.METADATA_KEY || '__persistedState';
+const mockGetPersistedState = getPersistedState as Mock;
+const TEST_METADATA_KEY = METADATA_KEY || '__persistedState';
 
 type MockWriteStream = {
   on: Mock<
@@ -228,7 +234,10 @@ describe('GCSTaskStore', () => {
       mockGunzipSync.mockReturnValue(
         Buffer.from(
           JSON.stringify({
-            [METADATA_KEY]: { _agentSettings: {}, _taskState: 'submitted' },
+            [TEST_METADATA_KEY]: {
+              _agentSettings: {},
+              _taskState: 'submitted',
+            },
             _contextId: 'ctx1',
           }),
         ),
@@ -282,7 +291,10 @@ describe('GCSTaskStore', () => {
       mockGunzipSync.mockReturnValue(
         Buffer.from(
           JSON.stringify({
-            [METADATA_KEY]: { _agentSettings: {}, _taskState: 'submitted' },
+            [TEST_METADATA_KEY]: {
+              _agentSettings: {},
+              _taskState: 'submitted',
+            },
             _contextId: 'ctx1',
           }),
         ),
diff --git a/packages/a2a-server/src/persistence/gcs.ts b/packages/a2a-server/src/persistence/gcs.ts
index 9f80990f4..ef952f49a 100644
--- a/packages/a2a-server/src/persistence/gcs.ts
+++ b/packages/a2a-server/src/persistence/gcs.ts
@@ -15,10 +15,7 @@ import type { Task as SDKTask } from '@a2a-js/sdk';
 import type { TaskStore } from '@a2a-js/sdk/server';
 import { logger } from '../utils/logger.js';
 import { setTargetDir } from '../config/config.js';
-import {
-  getPersistedState,
-  type PersistedTaskMetadata,
-} from '../metadata_types.js';
+import { getPersistedState, type PersistedTaskMetadata } from '../types.js';
 import { v4 as uuidv4 } from 'uuid';
 
 type ObjectType = 'metadata' | 'workspace';
diff --git a/packages/a2a-server/src/types.ts b/packages/a2a-server/src/types.ts
index c92412315..7e1ccba6d 100644
--- a/packages/a2a-server/src/types.ts
+++ b/packages/a2a-server/src/types.ts
@@ -102,3 +102,28 @@ export interface TaskMetadata {
     parameterSchema: unknown;
   }>;
 }
+
+export interface PersistedStateMetadata {
+  _agentSettings: AgentSettings;
+  _taskState: TaskState;
+}
+
+export type PersistedTaskMetadata = { [k: string]: unknown };
+
+export const METADATA_KEY = '__persistedState';
+
+export function getPersistedState(
+  metadata: PersistedTaskMetadata,
+): PersistedStateMetadata | undefined {
+  return metadata?.[METADATA_KEY] as PersistedStateMetadata | undefined;
+}
+
+export function setPersistedState(
+  metadata: PersistedTaskMetadata,
+  state: PersistedStateMetadata,
+): PersistedTaskMetadata {
+  return {
+    ...metadata,
+    [METADATA_KEY]: state,
+  };
+}
```

## Test Results
- Command: `npm run test`
- **PASSED** - All 3102 tests passed (55 skipped)
- Note: One flaky performance test in DebugLogger.test.ts failed initially but passed on re-run (unrelated to cherry-pick)

## Lint Results
- Command: `npm run lint`
- **PASSED** - Zero warnings/errors

## Typecheck Results
- Command: `npm run typecheck`
- **PASSED** - Zero errors

## Build Results
- Command: `npm run build`
- **PASSED** - Build successful

## Format Check
- Command: `npm run format`
- **PASSED** - Code formatted (auto-fixed formatting in useGeminiStream.ts, codeAssist.ts, and turn.ts)

## Lines of Code Analysis
- Upstream: 5 files changed, 55 insertions(+), 47 deletions(-)
- Local: 5 files changed, 55 insertions(+), 47 deletions(-)
- Perfect match - no variance

## Conflicts & Resolutions
- No conflicts encountered during cherry-pick
- Automatic adaptations made:
  - Package imports changed from `@google/gemini-cli-core` to `@vybestack/llxprt-code-core` in executor.ts
  - This preserves llxprt's multi-provider architecture

## Manual Verification Notes
- This commit consolidates A2A metadata types from a separate file into the main types.ts file
- The change is purely organizational and doesn't affect functionality
- No impact on multi-provider support
- Test mocking properly updated to use the new location

---

Store the completed file at `project-plans/20250916-cherries-v2/results/task-25.md` and rerun the quality gate after updates.