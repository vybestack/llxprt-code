/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { Box, Text } from 'ink';
import { buildProviderDerivedImageProfile } from '@vybestack/llxprt-code-providers';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { SemanticColors } from '../colors.js';
import { getBorderStyle } from '../contexts/UnicodeRenderingContext.js';
import { listImageModelChoices } from './imageModelWizard.js';

/** Provider-driven selection; configuration and credentials belong to the provider. */
function useImageModelDialog({
  onClose,
  imageProvider,
  fetchImpl,
}: {
  readonly onClose: () => void;
  readonly imageProvider?: string;
  readonly fetchImpl?: typeof fetch;
}) {
  const runtime = useRuntimeApi();
  const provider = imageProvider ?? runtime.getActiveProviderName();
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setModels([]);
    setSelected(0);
    void listImageModelChoices(provider, { fetchImpl }).then(
      (choices) => {
        if (!cancelled) {
          setModels(choices);
          setLoading(false);
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [provider, fetchImpl]);

  useKeypress(
    useCallback(
      (key) => {
        if (key.name === 'escape') {
          onClose();
          return true;
        }
        if (loading || models.length === 0) return false;
        if (key.name === 'up' || key.name === 'down') {
          const direction = key.name === 'up' ? -1 : 1;
          setSelected(
            (index) => (index + direction + models.length) % models.length,
          );
          return true;
        }
        if (key.name === 'return') {
          const model = models[selected];
          try {
            runtime.setActiveImageProfile({
              profile: { ...buildProviderDerivedImageProfile(provider), model },
            });
            onClose();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
          return true;
        }
        return false;
      },
      [loading, models, selected, runtime, provider, onClose],
    ),
    { isActive: true },
  );

  return { models, selected, error, loading, provider };
}

/** Provider-driven image model selection without changing the chat model. */
export function ImageModelsDialog(props: {
  readonly onClose: () => void;
  readonly imageProvider?: string;
  readonly fetchImpl?: typeof fetch;
}): JSX.Element {
  const { models, selected, error, loading, provider } =
    useImageModelDialog(props);
  const { width, isNarrow } = useResponsive();
  const start = Math.max(0, selected - 9);
  return (
    <Box
      flexDirection="column"
      borderStyle={getBorderStyle('round')}
      borderColor={SemanticColors.border.default}
      padding={1}
      width={width}
    >
      <Text bold color={SemanticColors.text.primary}>
        Image models: {provider}
      </Text>
      {loading && (
        <Text color={SemanticColors.text.secondary}>
          Loading image models...
        </Text>
      )}
      {error && <Text color={SemanticColors.status.error}>{error}</Text>}
      {!loading && !error && models.length === 0 && (
        <Text color={SemanticColors.text.secondary}>
          No image models are known for {provider}.
        </Text>
      )}
      {models.slice(start, start + 10).map((model, index) => (
        <Box key={`${start + index}:${model}`}>
          <Text
            color={
              start + index === selected
                ? SemanticColors.text.accent
                : SemanticColors.text.primary
            }
            wrap="truncate"
          >
            {start + index === selected ? '> ' : '  '}
            {model}
          </Text>
        </Box>
      ))}
      <Text color={SemanticColors.text.secondary}>
        {isNarrow
          ? '↑/↓ select · Enter apply · Esc close'
          : '↑/↓ to select, Enter to apply, Escape to close.'}
      </Text>
      <Text color={SemanticColors.text.secondary}>
        Save with /profile save image &lt;name&gt;.
      </Text>
    </Box>
  );
}
