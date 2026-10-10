/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Where a provider switch is recorded: the Agent session owner, or a test double. */
export interface ProviderSwitchRecorder {
  recordProviderSwitch(provider: string, model: string): void | Promise<void>;
}

/** The part of the runtime a switch recording reads the active provider from. */
export interface ActiveProviderStatusSource {
  providerStatus(): {
    providerName?: string | null;
    modelName?: string | null;
  };
}

/** The session owner's recording entry point; the only capability a recorder needs. */
type RecordSessionEvent = (event: {
  type: 'provider_switch';
  provider: string;
  model: string;
}) => void | Promise<void>;

/** Records through the Agent session owner, the single recording writer. */
export function agentProviderSwitchRecorder(
  recordEvent: RecordSessionEvent,
): ProviderSwitchRecorder {
  return {
    recordProviderSwitch: (provider, model) =>
      recordEvent({ type: 'provider_switch', provider, model }),
  };
}

/**
 * The recorder the profile dialogs use. In owner mode the Agent session owner
 * records; otherwise the raw integration does. The raw integration is swapped
 * when a session is resumed, so it is read from `integrationRef` at record
 * time, not when the recorder is built.
 */
export function dialogProviderSwitchRecorder(
  recordingOwner: 'agent' | 'raw' | undefined,
  recordEvent: RecordSessionEvent,
  integrationRef:
    | {
        readonly current: {
          recordProviderSwitch(provider: string, model: string): void;
        } | null;
      }
    | undefined,
): ProviderSwitchRecorder {
  if (recordingOwner === 'agent')
    return agentProviderSwitchRecorder(recordEvent);
  return {
    recordProviderSwitch: (provider, model) =>
      integrationRef?.current?.recordProviderSwitch(provider, model),
  };
}

/** The active provider/model as the Agent reports them. */
export function agentActiveProviderStatus(
  getProvider: () => string,
  getModel: () => string,
): ActiveProviderStatusSource {
  return {
    providerStatus: () => ({
      providerName: getProvider(),
      modelName: getModel(),
    }),
  };
}

type SwitchRecorder = ProviderSwitchRecorder;

type ResolvedSwitch = { provider: string; model: string };

/**
 * Record a provider/model switch that has already taken effect. This is the one
 * place a recording failure (for example the queue byte limit) is caught: the
 * switch itself succeeded, so the failure is handed to `reportFailure` for the
 * caller's own message channel instead of being thrown into the switch's error
 * handling or swallowed. Resolving the provider/model is part of recording, so
 * a failure to read them is reported the same way and records nothing.
 */
export async function recordProviderSwitchReportingFailure(
  recorder: SwitchRecorder | null | undefined,
  resolveSwitch: () => ResolvedSwitch,
  reportFailure: (message: string) => void,
): Promise<void> {
  if (recorder === null || recorder === undefined) return;
  let target = 'provider/model';
  try {
    const { provider, model } = resolveSwitch();
    target = `${provider}/${model}`;
    await recorder.recordProviderSwitch(provider, model);
  } catch (error) {
    reportFailure(
      `Switched to ${target}, but recording the switch in the session file failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Record, as a `provider_switch`, the provider/model the runtime is using
 * right now. Every UI path that changes the active provider or model after a
 * profile load goes through here so the recording history agrees with the
 * runtime regardless of which dialog or command made the change. Call it after
 * the switch's own success updates.
 *
 * `fallback` only fills fields the runtime status leaves empty.
 */
export async function recordActiveProviderSwitch(
  recorder: SwitchRecorder | null | undefined,
  runtime: ActiveProviderStatusSource,
  reportFailure: (message: string) => void,
  fallback: { providerName?: string; modelName?: string } = {},
): Promise<void> {
  return recordProviderSwitchReportingFailure(
    recorder,
    () => {
      const status = runtime.providerStatus();
      return {
        provider: status.providerName ?? fallback.providerName ?? '',
        model: status.modelName ?? fallback.modelName ?? 'unknown',
      };
    },
    reportFailure,
  );
}
