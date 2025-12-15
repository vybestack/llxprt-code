import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCliRenderer } from '@vybestack/opentui-core';
import {
  BoxRenderable,
  ImageRenderable,
  TextRenderable,
} from '@vybestack/opentui-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const logoPath = path.resolve(__dirname, '../llxprt.png');
  const logo = readFileSync(logoPath);

  const bg = '#fafafa';
  const border = '#2d7d46';
  const fg = '#222222';

  const renderer = await createCliRenderer({
    useAlternateScreen: false,
    exitOnCtrlC: false,
  });

  const header = new BoxRenderable(renderer, {
    id: 'header',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    border: true,
    height: 3,
    minHeight: 3,
    maxHeight: 3,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 1,
    paddingRight: 1,
    borderColor: border,
    backgroundColor: bg,
  });

  const logoAspectRatio = 415 / 260;
  const image = new ImageRenderable(renderer, {
    id: 'logo',
    src: logo,
    height: 1,
    aspectRatio: logoAspectRatio,
    fit: 'contain',
    backgroundColor: bg,
  });

  const title = new TextRenderable(renderer, {
    id: 'title',
    content: "LLxprt Code - I'm here to help",
    marginLeft: 1,
    fg,
  });

  header.add(image);
  header.add(title);
  renderer.root.add(header);

  renderer.start();

  // Give pixel resolution a moment to arrive and settle any re-layout.
  await new Promise((r) => setTimeout(r, 1500));
  renderer.pause();

  // Keep the frame visible for capture.
  await new Promise((r) => setTimeout(r, 6000));
  renderer.destroy();
}

await main();
