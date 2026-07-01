import {
  writeToStderr,
  writeToStdout,
  coreEvents,
  CoreEvent,
  type OutputPayload,
  type ConsoleLogPayload,
} from '@vybestack/llxprt-code-core';

export function initializeOutputListenersAndFlush() {
  // Each listener is gated independently so that an already-registered Output
  // listener (which would make listenerCount(Output) > 0) does NOT also skip
  // the ConsoleLog listener registration. Registering both only when their
  // own listener count is zero avoids duplicate sinks while ensuring both
  // sinks are attached when neither was pre-registered.
  if (coreEvents.listenerCount(CoreEvent.Output) === 0) {
    coreEvents.on(CoreEvent.Output, (payload: OutputPayload) => {
      if (payload.isStderr) {
        writeToStderr(payload.chunk, payload.encoding);
      } else {
        writeToStdout(payload.chunk, payload.encoding);
      }
    });
  }

  if (coreEvents.listenerCount(CoreEvent.ConsoleLog) === 0) {
    coreEvents.on(CoreEvent.ConsoleLog, (payload: ConsoleLogPayload) => {
      if (payload.type === 'error' || payload.type === 'warn') {
        writeToStderr(payload.content);
      } else {
        writeToStdout(payload.content);
      }
    });
  }
  coreEvents.drainBacklogs();
}
