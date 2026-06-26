export type { StorageLogger, NullStorageLogger } from './types/logger.js';
export { NullStorageLoggerImpl } from './types/logger.js';

// Storage paths and constants
export {
  Storage,
  LLXPRT_DIR,
  PROVIDER_ACCOUNTS_FILENAME,
  OAUTH_FILE,
} from './config/storage.js';

// File services
export {
  FileSystemService,
  StandardFileSystemService,
} from './services/fileSystemService.js';
export { FileDiscoveryService } from './services/fileDiscoveryService.js';
export type {
  FilterFilesOptions,
  FilterReport,
} from './services/fileDiscoveryService.js';

// Secure storage
export {
  SecureStore,
  SecureStoreError,
  createDefaultKeyringAdapter,
} from './secure-store/secure-store.js';
export type {
  KeyringAdapter,
  SecureStoreErrorCode,
  SecureStoreOptions,
} from './secure-store/secure-store.js';
export {
  ProviderKeyStorage,
  KEY_NAME_REGEX,
  getProviderKeyStorage,
  resetProviderKeyStorage,
  validateKeyName,
} from './secure-store/provider-key-storage.js';

// Shared envelope codec for sibling encrypted file stores
export {
  encryptEnvelopeString,
  decryptEnvelopeString,
  readEnvelopeVersion,
  EnvelopeCodecError,
} from './secure-store/envelope-codec.js';
export type {
  Envelope,
  EnvelopeCodecOptions,
  EnvelopeCodecErrorCode,
  EncryptEnvelopeStringOptions,
} from './secure-store/envelope-codec.js';
export { isValidEnvelope } from './secure-store/envelope.js';

// Session types and constants
export { SESSION_FILE_PREFIX } from './session/sessionTypes.js';
export type {
  ConversationRecord,
  BaseMessageRecord,
  ToolCallRecord,
} from './session/sessionTypes.js';

// Conversation file writer
export {
  ConversationFileWriter,
  getConversationFileWriter,
} from './conversation/ConversationFileWriter.js';
