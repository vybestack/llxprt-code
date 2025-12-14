import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestRenderer } from '@vybestack/opentui-core/testing';
import {
  BoxRenderable,
  ImageRenderable,
  type CellMetrics,
} from '@vybestack/opentui-core';
import { TextRenderable } from '@vybestack/opentui-core';

type SharpModule = typeof import('sharp');

async function getSharp(): Promise<SharpModule> {
  const sharpModule: unknown = await import('sharp');
  const moduleCandidate = sharpModule as { default?: unknown };
  return (
    typeof moduleCandidate.default === 'function'
      ? moduleCandidate.default
      : sharpModule
  ) as SharpModule;
}

function parseFirstItermImagePayload(writes: string[]): {
  row1: number;
  col1: number;
  width: number;
  height: number;
  widthUnit: 'px' | 'cells';
  heightUnit: 'px' | 'cells';
  preserveAspectRatio: number;
  png: Buffer;
} {
  const output = writes.join('');
  const match = output.match(
    /\x1b\[(\d+);(\d+)H\x1b\]1337;File=inline=1;width=(\d+)(px)?;height=(\d+)(px)?;preserveAspectRatio=(\d+):([A-Za-z0-9+/=]+)\x07/,
  );
  if (!match) {
    throw new Error('No iTerm2 inline image sequence found in renderer output');
  }

  const row1 = Number(match[1]);
  const col1 = Number(match[2]);
  const width = Number(match[3]);
  const widthUnit: 'px' | 'cells' = match[4] === 'px' ? 'px' : 'cells';
  const height = Number(match[5]);
  const heightUnit: 'px' | 'cells' = match[6] === 'px' ? 'px' : 'cells';
  const preserveAspectRatio = Number(match[7]);
  const png = Buffer.from(match[8], 'base64');

  if (
    !Number.isFinite(row1) ||
    !Number.isFinite(col1) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    throw new Error('Failed to parse iTerm2 image move/size from output');
  }

  if (!Number.isFinite(preserveAspectRatio)) {
    throw new Error(
      'Failed to parse preserveAspectRatio from iTerm2 image payload',
    );
  }

  return {
    row1,
    col1,
    width,
    height,
    widthUnit,
    heightUnit,
    preserveAspectRatio,
    png,
  };
}

async function assertContainPaddingPreservesAlpha(): Promise<void> {
  const { renderer, renderOnce } = await createTestRenderer({
    width: 80,
    height: 24,
  });

  const writes: string[] = [];
  const testHarness = renderer as unknown as {
    _graphicsSupport: { protocol: 'iterm2' };
    getCellMetrics: () => CellMetrics | null;
    writeOut: (chunk: string) => boolean;
  };
  testHarness._graphicsSupport = { protocol: 'iterm2' };
  testHarness.getCellMetrics = () => ({ pxPerCellX: 10, pxPerCellY: 20 });
  testHarness.writeOut = (chunk: string) => {
    writes.push(chunk);
    return true;
  };

  const sharp = await getSharp();
  const input = await sharp({
    create: {
      width: 100,
      height: 50,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const bg = '#fafafa';
  const image = new ImageRenderable(renderer, {
    id: 'padding-bg-test',
    src: input,
    fit: 'contain',
    pixelWidth: 50,
    pixelHeight: 50,
    backgroundColor: bg,
    alignSelf: 'flex-start',
  });

  renderer.root.add(image);
  await renderOnce();
  renderer.destroy();

  const { png, width, height, widthUnit, heightUnit, preserveAspectRatio } =
    parseFirstItermImagePayload(writes);
  if (widthUnit !== 'cells' || heightUnit !== 'cells') {
    throw new Error(
      `Expected iTerm2 image sizing in cells, got widthUnit=${widthUnit} heightUnit=${heightUnit}`,
    );
  }
  if (preserveAspectRatio !== 0) {
    throw new Error(
      `Expected iTerm2 preserveAspectRatio=0 (renderer pre-sizes images), got ${preserveAspectRatio}`,
    );
  }

  const expectedWidthPx = Math.max(1, Math.floor(width * 10));
  const expectedHeightPx = Math.max(1, Math.floor(height * 20));

  const meta = await sharp(png).metadata();
  const widthPx = meta.width;
  const heightPx = meta.height;
  if (!widthPx || !heightPx) {
    throw new Error('Failed to read PNG metadata from iTerm2 payload');
  }
  if (widthPx !== expectedWidthPx || heightPx !== expectedHeightPx) {
    throw new Error(
      `Unexpected resized PNG dimensions: expected ${expectedWidthPx}x${expectedHeightPx}, got ${widthPx}x${heightPx}`,
    );
  }

  const raw = await sharp(png).ensureAlpha().raw().toBuffer();
  const stride = widthPx * 4;
  const corners = [
    { x: 0, y: 0 },
    { x: widthPx - 1, y: 0 },
    { x: 0, y: heightPx - 1 },
    { x: widthPx - 1, y: heightPx - 1 },
  ];

  for (const { x, y } of corners) {
    const idx = y * stride + x * 4;
    const a = raw[idx + 3];
    if (a !== 0) {
      throw new Error(
        `Contain padding corner alpha mismatch at (${x},${y}): expected alpha=0, got alpha=${a}`,
      );
    }
  }

  // Sanity check: the center pixel should still be opaque from the source content.
  const centerIdx =
    Math.floor(heightPx / 2) * stride + Math.floor(widthPx / 2) * 4;
  const centerAlpha = raw[centerIdx + 3];
  if (centerAlpha === 0) {
    throw new Error(
      `Expected contain-resized PNG center pixel to be opaque, got alpha=${centerAlpha}`,
    );
  }
}

async function assertHeaderImagePayloadMatchesLayout(): Promise<void> {
  const { renderer, renderOnce } = await createTestRenderer({
    width: 80,
    height: 24,
  });

  const writes: string[] = [];
  const testHarness = renderer as unknown as {
    _graphicsSupport: { protocol: 'iterm2' };
    getCellMetrics: () => CellMetrics | null;
    writeOut: (chunk: string) => boolean;
  };
  testHarness._graphicsSupport = { protocol: 'iterm2' };
  testHarness.getCellMetrics = () => ({ pxPerCellX: 10, pxPerCellY: 20 });
  testHarness.writeOut = (chunk: string) => {
    writes.push(chunk);
    return true;
  };

  const bg = '#101010';
  const header = new BoxRenderable(renderer, {
    id: 'header',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    border: true,
    height: 3,
    minHeight: 3,
    maxHeight: 3,
    backgroundColor: bg,
  });

  const logoPath = fileURLToPath(new URL('../llxprt.png', import.meta.url));
  const logo = readFileSync(logoPath);
  const aspectRatio = 415 / 260;

  const image = new ImageRenderable(renderer, {
    id: 'logo',
    src: logo,
    height: 1,
    aspectRatio,
    fit: 'contain',
    backgroundColor: bg,
  });
  header.add(image);
  renderer.root.add(header);

  await renderOnce();
  renderer.destroy();

  const {
    row1,
    col1,
    width,
    height,
    widthUnit,
    heightUnit,
    preserveAspectRatio,
    png,
  } = parseFirstItermImagePayload(writes);
  if (widthUnit !== 'cells' || heightUnit !== 'cells') {
    throw new Error(
      `Expected iTerm2 image sizing in cells, got widthUnit=${widthUnit} heightUnit=${heightUnit}`,
    );
  }
  if (preserveAspectRatio !== 0) {
    throw new Error(
      `Expected iTerm2 preserveAspectRatio=0 (renderer pre-sizes images), got ${preserveAspectRatio}`,
    );
  }

  if (row1 !== image.y + 1 || col1 !== image.x + 1) {
    throw new Error(
      `Expected iTerm2 image cursor to match layout. got row=${row1} col=${col1}, expected row=${image.y + 1} col=${image.x + 1}`,
    );
  }

  if (width !== image.width || height !== image.height) {
    throw new Error(
      `Expected iTerm2 image cell size to match layout. got ${width}x${height}, expected ${image.width}x${image.height}`,
    );
  }

  const sharp = await getSharp();
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Failed to read PNG metadata from iTerm2 payload');
  }

  const expectedWidthPx = width * 10;
  const expectedHeightPx = height * 20;
  if (meta.width !== expectedWidthPx || meta.height !== expectedHeightPx) {
    throw new Error(
      `Unexpected resized PNG dimensions: expected ${expectedWidthPx}x${expectedHeightPx}, got ${meta.width}x${meta.height}`,
    );
  }
}

async function assertMovedImageClearsPreviousInlineArea(): Promise<void> {
  const { renderer, renderOnce } = await createTestRenderer({
    width: 40,
    height: 12,
  });

  const writes: string[] = [];
  const testHarness = renderer as unknown as {
    _graphicsSupport: { protocol: 'iterm2' };
    getCellMetrics: () => CellMetrics | null;
    writeOut: (chunk: string) => boolean;
  };
  testHarness._graphicsSupport = { protocol: 'iterm2' };
  testHarness.writeOut = (chunk: string) => {
    writes.push(chunk);
    return true;
  };

  // Fixed-size container so justifyContent:center shifts the image when its measured width changes.
  const container = new BoxRenderable(renderer, {
    id: 'container',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 6,
    width: 20,
  });

  const bg = '#fafafa';
  const image = new ImageRenderable(renderer, {
    id: 'move-test-image',
    src: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P8z/D/PwAHggJ/Pq2uGAAAAABJRU5ErkJggg==',
      'base64',
    ),
    pixelWidth: 40,
    pixelHeight: 40,
    backgroundColor: bg,
    alignSelf: 'flex-start',
  });

  container.add(image);
  renderer.root.add(container);

  // First render: no metrics, ImageRenderable falls back to 9x20 => width=5 cells for 40px.
  testHarness.getCellMetrics = () => null;
  await renderOnce();
  const first = parseFirstItermImagePayload(writes);
  const firstCursor = { row1: first.row1, col1: first.col1 };
  writes.length = 0;

  // Second render: metrics change to 20x40 => width=2 cells for 40px, shifting X due to centering.
  testHarness.getCellMetrics = () => ({ pxPerCellX: 20, pxPerCellY: 40 });
  renderer.emit('pixelResolution', { width: 800, height: 480 });
  await renderOnce();
  renderer.destroy();

  const second = parseFirstItermImagePayload(writes);
  const secondCursor = { row1: second.row1, col1: second.col1 };

  if (
    firstCursor.row1 === secondCursor.row1 &&
    firstCursor.col1 === secondCursor.col1
  ) {
    throw new Error(
      'Expected image cursor position to change between renders, but it did not',
    );
  }

  const output = writes.join('');
  const clearAtOld = `\u001b[${firstCursor.row1};${firstCursor.col1}H\u001b[0m`;
  const clearIndex = output.indexOf(clearAtOld);
  if (clearIndex === -1) {
    throw new Error(
      'Expected iTerm2 inline clear sequence at previous cursor position, but none was found',
    );
  }

  const newMove = `\u001b[${secondCursor.row1};${secondCursor.col1}H\u001b]1337;File=inline=1;`;
  const newIndex = output.indexOf(newMove);
  if (newIndex === -1) {
    throw new Error(
      'Expected iTerm2 inline image sequence for second render, but none was found',
    );
  }

  if (clearIndex > newIndex) {
    throw new Error(
      'Expected inline clear to occur before the moved image is drawn',
    );
  }
}

async function assertResizedImageClearsPreviousInlineArea(): Promise<void> {
  const { renderer, renderOnce } = await createTestRenderer({
    width: 20,
    height: 10,
  });

  const writes: string[] = [];
  const testHarness = renderer as unknown as {
    _graphicsSupport: { protocol: 'iterm2' };
    getCellMetrics: () => CellMetrics | null;
    writeOut: (chunk: string) => boolean;
  };
  testHarness._graphicsSupport = { protocol: 'iterm2' };
  testHarness.getCellMetrics = () => ({ pxPerCellX: 10, pxPerCellY: 20 });
  testHarness.writeOut = (chunk: string) => {
    writes.push(chunk);
    return true;
  };

  const bg = '#fafafa';
  const image = new ImageRenderable(renderer, {
    id: 'resize-test-image',
    src: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P8z/D/PwAHggJ/Pq2uGAAAAABJRU5ErkJggg==',
      'base64',
    ),
    width: 5,
    height: 2,
    backgroundColor: bg,
    alignSelf: 'flex-start',
  });

  renderer.root.add(image);

  await renderOnce();
  const first = parseFirstItermImagePayload(writes);
  const firstCursor = { row1: first.row1, col1: first.col1 };
  writes.length = 0;

  // Redraw at the same cell position, but with a different pixel backing size
  // (simulating a pixel-resolution/cell-metrics change).
  testHarness.getCellMetrics = () => ({ pxPerCellX: 11, pxPerCellY: 21 });
  renderer.emit('pixelResolution', { width: 220, height: 210 });

  await renderOnce();
  renderer.destroy();

  const second = parseFirstItermImagePayload(writes);
  const secondCursor = { row1: second.row1, col1: second.col1 };

  if (
    firstCursor.row1 !== secondCursor.row1 ||
    firstCursor.col1 !== secondCursor.col1
  ) {
    throw new Error(
      'Expected image cursor position to remain the same between resize renders, but it changed',
    );
  }

  const output = writes.join('');
  const clearAt = `\u001b[${firstCursor.row1};${firstCursor.col1}H\u001b[0m`;
  const clearIndex = output.indexOf(clearAt);
  if (clearIndex === -1) {
    throw new Error(
      'Expected iTerm2 inline clear sequence before resized redraw, but none was found',
    );
  }

  const newMove = `\u001b[${secondCursor.row1};${secondCursor.col1}H\u001b]1337;File=inline=1;`;
  const newIndex = output.indexOf(newMove);
  if (newIndex === -1) {
    throw new Error(
      'Expected iTerm2 inline image sequence for resized render, but none was found',
    );
  }

  if (clearIndex > newIndex) {
    throw new Error(
      'Expected inline clear to occur before the resized image is drawn',
    );
  }
}

async function assertHeaderLayoutBehavesLikeImg(): Promise<void> {
  const { renderer, renderOnce } = await createTestRenderer({
    width: 80,
    height: 24,
  });

  const testHarness = renderer as unknown as {
    getCellMetrics: () => CellMetrics | null;
    _graphicsSupport: { protocol: 'none' };
  };
  testHarness.getCellMetrics = () => ({ pxPerCellX: 10, pxPerCellY: 20 });
  testHarness._graphicsSupport = { protocol: 'none' };

  const bg = '#101010';
  const header = new BoxRenderable(renderer, {
    id: 'header',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    border: true,
    height: 3,
    minHeight: 3,
    maxHeight: 3,
    backgroundColor: bg,
  });

  const aspectRatio = 415 / 260;
  const image = new ImageRenderable(renderer, {
    id: 'logo',
    src: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P8z/D/PwAHggJ/Pq2uGAAAAABJRU5ErkJggg==',
      'base64',
    ),
    height: 1,
    aspectRatio,
    backgroundColor: bg,
  });

  const text = new TextRenderable(renderer, {
    id: 'title',
    content: "LLxprt Code - I'm here to help",
    marginLeft: 1,
  });

  header.add(image);
  header.add(text);
  renderer.root.add(header);

  await renderOnce();
  renderer.destroy();

  if (header.height !== 3) {
    throw new Error(`Expected header height=3, got ${header.height}`);
  }

  if (image.height !== 1) {
    throw new Error(`Expected image height=1 cell, got ${image.height}`);
  }

  if (image.width !== 4) {
    throw new Error(`Expected image width=4 cells, got ${image.width}`);
  }

  if (text.x < image.x + image.width) {
    throw new Error(
      `Expected text to start after image. image ends at x=${image.x + image.width}, text starts at x=${text.x}`,
    );
  }

  if (text.y !== image.y) {
    throw new Error(
      `Expected image and text to share y (vertical centering). image.y=${image.y}, text.y=${text.y}`,
    );
  }
}

async function main(): Promise<void> {
  const failures: Array<{ name: string; error: string }> = [];

  const tests: Array<{ name: string; run: () => Promise<void> }> = [
    {
      name: 'contain-padding-alpha',
      run: assertContainPaddingPreservesAlpha,
    },
    {
      name: 'header-image-payload-matches-layout',
      run: assertHeaderImagePayloadMatchesLayout,
    },
    {
      name: 'move-clears-previous-inline',
      run: assertMovedImageClearsPreviousInlineArea,
    },
    {
      name: 'redraw-clears-previous-inline',
      run: assertResizedImageClearsPreviousInlineArea,
    },
    {
      name: 'header-layout-behaves-like-img',
      run: assertHeaderLayoutBehavesLikeImg,
    },
  ];

  for (const t of tests) {
    try {
      await t.run();
    } catch (err) {
      failures.push({
        name: t.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (failures.length > 0) {
    console.error(JSON.stringify({ ok: false, failures }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true }));
}

await main();
