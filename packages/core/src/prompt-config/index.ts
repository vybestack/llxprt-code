/**
 * Main exports for the prompt-config module
 */

export { TemplateEngine } from './TemplateEngine.js';
export { PromptLoader } from './prompt-loader.js';
export { PromptCache } from './prompt-cache.js';
export { PromptResolver } from './prompt-resolver.js';
export { PromptInstaller } from './prompt-installer.js';
export { PromptService } from './prompt-service.js';
export type {
  TemplateVariables,
  TemplateProcessingOptions,
  PromptContext,
  PromptEnvironment,
} from './types.js';
export type {
  LoadFileResult,
  EnvironmentInfo,
  FileWatcher,
  FileChangeCallback,
} from './prompt-loader.js';
export type { CacheEntry, CacheStats } from './prompt-cache.js';
export type {
  ResolveFileResult,
  ResolvedFile,
  AvailableFile,
  ValidationResult,
} from './prompt-resolver.js';
export type {
  InstallOptions,
  InstallResult,
  UninstallOptions,
  UninstallResult,
  ValidationResult as InstallerValidationResult,
  RepairOptions,
  RepairResult,
  BackupResult,
  DefaultsMap,
} from './prompt-installer.js';
export { DEFAULT_BASE_DIR, REQUIRED_DIRECTORIES } from './prompt-installer.js';
export type {
  PromptServiceConfig,
  ValidationResult as PromptServiceValidationResult,
} from './prompt-service.js';
