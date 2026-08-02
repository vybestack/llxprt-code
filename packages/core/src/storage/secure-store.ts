export {
  SecureStore,
  SecureStoreError,
  createDefaultKeyringAdapter,
} from '@vybestack/llxprt-code-storage/storage/secure-store.js';
export type {
  KeyringAdapter,
  SecureStoreOptions,
  SecureStoreErrorCode,
} from '@vybestack/llxprt-code-storage/storage/secure-store.js';
export { isRuntimeReplacedError } from '@vybestack/llxprt-code-storage/storage/secure-store.js';
export {
  forceRuntimeReplacedForTesting,
  resetRuntimeIdentityForTesting,
  resetRuntimeReplacedWarningForTesting,
} from '@vybestack/llxprt-code-storage/storage/secure-store.js';
