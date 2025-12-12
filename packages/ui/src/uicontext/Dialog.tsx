import React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useKeyboard } from '@vybestack/opentui-react';

interface DialogContextValue {
  readonly replace: (element: ReactNode) => void;
  readonly clear: () => void;
  readonly isOpen: boolean;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const context = useContext(DialogContext);
  if (context === null) {
    throw new Error('useDialog must be used within Dialog');
  }
  return context;
}

interface DialogProps {
  readonly children: ReactNode;
}

export function Dialog({ children }: DialogProps): React.ReactNode {
  const [dialogStack, setDialogStack] = useState<ReactNode[]>([]);

  const replace = useCallback((element: ReactNode) => {
    setDialogStack([element]);
  }, []);

  const clear = useCallback(() => {
    setDialogStack([]);
  }, []);

  const isOpen = dialogStack.length > 0;
  const currentDialog = dialogStack[0] ?? null;

  useKeyboard((key) => {
    if (key.eventType === 'press' && key.name === 'escape' && isOpen) {
      clear();
    }
  });

  const contextValue = useMemo(
    () => ({ replace, clear, isOpen }),
    [replace, clear, isOpen],
  );

  return (
    <DialogContext.Provider value={contextValue}>
      {children}
      {currentDialog}
    </DialogContext.Provider>
  );
}

export type { DialogContextValue };
