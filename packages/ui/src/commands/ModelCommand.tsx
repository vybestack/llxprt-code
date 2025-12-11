import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useCommand } from '../uicontext';
import { SearchSelectModal } from '../ui/modals';
import type { SearchItem } from '../ui/modals/types';
import type { SessionConfig } from '../features/config';
import type { ThemeDefinition } from '../features/theme';

interface ModelCommandProps {
  readonly fetchModelItems: () => Promise<{
    items: SearchItem[];
    messages?: string[];
  }>;
  readonly sessionConfig: SessionConfig;
  readonly setSessionConfig: (config: SessionConfig) => void;
  readonly appendMessage: (
    role: 'user' | 'model' | 'system',
    text: string,
  ) => string;
  readonly theme: ThemeDefinition;
  readonly focusInput: () => void;
}

export function ModelCommand({
  fetchModelItems,
  sessionConfig,
  setSessionConfig,
  appendMessage,
  theme,
  focusInput,
}: ModelCommandProps): React.ReactNode | null {
  const { register } = useCommand();
  const dialogClearRef = useRef<(() => void) | null>(null);
  const [modalItems, setModalItems] = useState<SearchItem[]>([]);

  const handleClose = useCallback((): void => {
    if (dialogClearRef.current !== null) {
      dialogClearRef.current();
    }
    focusInput();
  }, [focusInput]);

  const handleSelect = useCallback(
    (item: SearchItem): void => {
      setSessionConfig({ ...sessionConfig, model: item.id });
      appendMessage('system', `Selected model: ${item.label}`);
      if (dialogClearRef.current !== null) {
        dialogClearRef.current();
      }
      focusInput();
    },
    [sessionConfig, setSessionConfig, appendMessage, focusInput],
  );

  const modal = useMemo(
    () => (
      <SearchSelectModal
        title="Search Models"
        noun="models"
        items={modalItems}
        alphabetical
        footerHint="Tab to switch modes"
        onClose={handleClose}
        onSelect={handleSelect}
        theme={theme}
      />
    ),
    [modalItems, handleClose, handleSelect, theme],
  );

  useEffect(() => {
    const cleanup = register([
      {
        name: '/model',
        title: 'Select Model',
        category: 'configuration',
        onExecute: async (dialog) => {
          const result = await fetchModelItems();
          if (result.messages !== undefined && result.messages.length > 0) {
            appendMessage('system', result.messages.join('\n'));
          }
          if (result.items.length === 0) {
            return;
          }

          dialogClearRef.current = dialog.clear;
          setModalItems(result.items);
          dialog.replace(modal);
        },
      },
    ]);

    return cleanup;
  }, [register, fetchModelItems, appendMessage, modal]);

  return null;
}
