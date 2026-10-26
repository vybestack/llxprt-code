/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CliUiRuntime } from './cliUiRuntime.js';
import type { SlashCommandProcessorPorts } from './hooks/useSlashCommandProcessorCore.js';

/**
 * Composition root for the slash-command processor. The runtime is built once
 * at the CLI composition edge; this is where it is turned into the named ports
 * the processor's command families read, so no consumer below receives the
 * aggregate.
 */
export function bindSlashCommandRuntimePorts(
  runtime: CliUiRuntime,
): SlashCommandProcessorPorts {
  return {
    extensions: runtime,
    hosts: runtime,
    trust: runtime,
    logging: runtime,
    skills: runtime.skillOperations,
    emojiFilter: runtime,
    commandLogging: runtime,
    about: runtime,
    diagnostics: runtime,
    history: runtime,
    readScreenReader: () => runtime.getScreenReader(),
    readTargetDir: () => runtime.getTargetDir(),
    resumeSession: runtime,
  };
}
