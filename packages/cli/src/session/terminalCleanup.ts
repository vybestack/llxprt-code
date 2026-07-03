import { disableMouseEvents } from '../ui/utils/mouse.js';

/**
 * Module-level mouse-events teardown handler for the process 'exit' event.
 *
 * Must be module-level (not a local inside startInteractiveUI) so the SAME
 * function reference is passed to process.off and process.on across repeated
 * startInteractiveUI calls. A local named function would be a fresh reference
 * each call, so process.off could never remove a previously-registered
 * listener and duplicates would still accumulate.
 *
 * Full synchronous terminal protocol restoration is handled by
 * restoreTerminalProtocolsSync; this handler only updates the mouse module's
 * active state and emits the legacy mouse-disable sequence once.
 */
export function mouseEventsExitHandler(): void {
  try {
    disableMouseEvents();
  } catch {
    // Terminal may already be closed — ignore shutdown failures.
  }
}
