import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import { useCommand } from '../uicontext';
import { AuthModal, AUTH_DEFAULTS, type AuthOption } from '../ui/modals';
import type { ThemeDefinition } from '../features/theme';

interface AuthCommandProps {
  readonly appendMessage: (
    role: 'user' | 'model' | 'system',
    text: string,
  ) => string;
  readonly theme: ThemeDefinition;
  readonly focusInput: () => void;
}

export function AuthCommand({
  appendMessage,
  theme,
  focusInput,
}: AuthCommandProps): JSX.Element | null {
  const { register } = useCommand();
  const [authOptions, setAuthOptions] = useState<AuthOption[]>(AUTH_DEFAULTS);
  const dialogClearRef = useRef<(() => void) | null>(null);

  const handleSave = useCallback(
    (next: AuthOption[]): void => {
      setAuthOptions(next);
      const enabled = next
        .filter((opt) => opt.id !== 'close' && opt.enabled)
        .map((opt) => opt.label.replace(/^\d+\.\s*/, ''));
      appendMessage(
        'system',
        `Auth providers: ${enabled.join(', ') || 'none'}`,
      );
    },
    [appendMessage],
  );

  const handleClose = useCallback((): void => {
    if (dialogClearRef.current !== null) {
      dialogClearRef.current();
    }
    focusInput();
  }, [focusInput]);

  const modal = useMemo(
    () => (
      <AuthModal
        options={authOptions}
        onClose={handleClose}
        onSave={handleSave}
        theme={theme}
      />
    ),
    [authOptions, handleClose, handleSave, theme],
  );

  useEffect(() => {
    const cleanup = register([
      {
        name: '/auth',
        title: 'OAuth Authentication',
        category: 'authentication',
        onExecute: (dialog) => {
          dialogClearRef.current = dialog.clear;
          dialog.replace(modal);
        },
      },
    ]);

    return cleanup;
  }, [register, modal]);

  return null;
}
