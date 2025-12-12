import clipboardy from 'clipboardy';

export async function readClipboardText(): Promise<string | undefined> {
  try {
    const text = await clipboardy.read();
    return text.trim().length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  try {
    await clipboardy.write(text);
  } catch {
    // ignore copy failures; OSC52 will still have been attempted
  }
}
