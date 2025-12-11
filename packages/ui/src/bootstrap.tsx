import { createCliRenderer } from '@vybestack/opentui-core';
import { createRoot } from '@vybestack/opentui-react';
import { App } from './app';
import type { UILaunchConfig } from './types';

/**
 * Start the NUI with the given configuration
 * This is the entry point when launched from the CLI with --experimental-ui
 */
export async function startNui(config: UILaunchConfig): Promise<void> {
  // Config initialization happens in App component
  console.log('Starting NUI with config:', config);

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useMouse: true,
    useAlternateScreen: true,
    useKittyKeyboard: { events: true },
  });

  createRoot(renderer).render(<App />);
  renderer.start();
}
