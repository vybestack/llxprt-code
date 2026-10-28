/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type React from 'react';
import { useEffect } from 'react';
import { Text } from 'ink';
import { Colors } from '../ui/colors.js';
import { useSessionState } from '../ui/contexts/SessionStateContext.js';
import { useProviderAliasRefresh } from '../ui/contexts/ProviderAliasRefreshContext.js';
import { useRuntimeApi, type RuntimeApi } from './runtime-context-fixture.js';

export function OwnerView({
  label,
  onApi,
}: {
  label: string;
  onApi?: (api: RuntimeApi) => void;
}): React.ReactElement {
  const runtime = useRuntimeApi();
  useEffect(() => {
    onApi?.(runtime);
  }, [onApi, runtime]);
  return (
    <Text color={Colors.Foreground}>
      {label}:{runtime.getActiveProviderName()}:{runtime.getActiveModelName()}:
      {String(runtime.getEphemeralSetting('bridge-owner-key'))}
    </Text>
  );
}

export function AliasRefreshView({
  onRefresh,
}: {
  onRefresh: (refresh: () => Promise<void>) => void;
}): React.ReactElement {
  const refresh = useProviderAliasRefresh();
  useEffect(() => onRefresh(refresh), [onRefresh, refresh]);
  return <Text color={Colors.Foreground}>alias-refresh-ready</Text>;
}

export function ModelEventView(): React.ReactElement {
  const [state] = useSessionState();
  return (
    <Text color={Colors.Foreground}>event-model:{state.currentModel}</Text>
  );
}
