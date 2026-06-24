/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  IDE_DEFINITIONS,
  detectIdeFromEnv,
  detectIde,
  isCloudShell,
  type IdeInfo,
} from './detect-ide.js';
export { LLXPRT_CODE_COMPANION_EXTENSION_NAME } from './constants.js';
export { getIdeProcessInfo } from './process-utils.js';
export {
  FileSchema,
  IdeContextSchema,
  IdeContextNotificationSchema,
  IdeDiffAcceptedNotificationSchema,
  IdeDiffRejectedNotificationSchema,
  IdeDiffClosedNotificationSchema,
  CloseDiffResponseSchema,
  createIdeContextStore,
  ideContext,
  type IdeContext,
  type File,
  type DiffUpdateResult,
} from './ideContext.js';
export {
  IdeClient,
  IDEConnectionStatus,
  type IDEConnectionState,
} from './ide-client.js';
export {
  getIdeInstaller,
  type IdeInstaller,
  type InstallResult,
} from './ide-installer.js';
export {
  isFakeIdeActive,
  fakeIdeFixturePath,
  loadFakeIdeFixture,
  trustFakeIde,
  type FakeIdeFixture,
  type FakeIdeFixtureEntry,
} from './fake-ide-environment.js';
