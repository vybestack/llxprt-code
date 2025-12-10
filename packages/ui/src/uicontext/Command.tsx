import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import type { DialogContextValue } from './Dialog';

interface CommandDef {
  readonly name: string;
  readonly title: string;
  readonly category?: string;
  readonly onExecute: (dialog: DialogContextValue) => void | Promise<void>;
}

interface CommandContextValue {
  readonly register: (commands: CommandDef[]) => () => void;
  readonly trigger: (name: string) => Promise<boolean>;
  readonly getCommands: () => CommandDef[];
}

const CommandContext = createContext<CommandContextValue | null>(null);

export function useCommand(): CommandContextValue {
  const context = useContext(CommandContext);
  if (context === null) {
    throw new Error('useCommand must be used within Command');
  }
  return context;
}

interface CommandProps {
  readonly children: ReactNode;
  readonly dialogContext: DialogContextValue;
}

let registrationId = 0;

export function Command({
  children,
  dialogContext,
}: CommandProps): JSX.Element {
  const [commands, setCommands] = useState<Map<string, CommandDef>>(new Map());
  const mountedComponents = useRef(new Set<number>());

  const register = useCallback((newCommands: CommandDef[]) => {
    registrationId += 1;
    const componentId = registrationId;
    mountedComponents.current.add(componentId);

    setCommands((prev) => {
      const next = new Map(prev);
      for (const command of newCommands) {
        next.set(command.name, command);
      }
      return next;
    });

    return () => {
      mountedComponents.current.delete(componentId);
      setCommands((prev) => {
        const next = new Map(prev);
        for (const command of newCommands) {
          next.delete(command.name);
        }
        return next;
      });
    };
  }, []);

  const trigger = useCallback(
    async (name: string): Promise<boolean> => {
      const command = commands.get(name);
      if (command === undefined) {
        return false;
      }
      await command.onExecute(dialogContext);
      return true;
    },
    [commands, dialogContext],
  );

  const getCommands = useCallback((): CommandDef[] => {
    return Array.from(commands.values());
  }, [commands]);

  const contextValue = useMemo(
    () => ({ register, trigger, getCommands }),
    [register, trigger, getCommands],
  );

  return (
    <CommandContext.Provider value={contextValue}>
      {children}
    </CommandContext.Provider>
  );
}

export type { CommandDef };
