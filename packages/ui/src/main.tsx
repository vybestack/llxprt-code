import { createCliRenderer } from '@vybestack/opentui-core';
import { createRoot } from '@vybestack/opentui-react';
import { App } from './app';

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  useMouse: true,
  useAlternateScreen: true,
  useKittyKeyboard: { events: true },
});

createRoot(renderer).render(<App />);
renderer.start();
