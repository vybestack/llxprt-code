/**
 * Logger interface for the storage package.
 * Injected by consumers to decouple storage from core's logging.
 */

export interface StorageLogger {
  debug(message: string | (() => string), ...context: unknown[]): void;
  warn(message: string | (() => string), ...context: unknown[]): void;
  error(message: string | (() => string), ...context: unknown[]): void;
}

/** Type-only marker for the null-logger (no runtime footprint). */
export type NullStorageLogger = StorageLogger;

/** Concrete null-logger that silently discards all output. */
export class NullStorageLoggerImpl implements StorageLogger {
  debug(_message: string | (() => string), ..._context: unknown[]): void {
    // no-op
  }
  warn(_message: string | (() => string), ..._context: unknown[]): void {
    // no-op
  }
  error(_message: string | (() => string), ..._context: unknown[]): void {
    // no-op
  }
}
