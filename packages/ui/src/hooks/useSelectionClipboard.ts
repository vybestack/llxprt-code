import { useCallback } from 'react';
import clipboard from 'clipboardy';

/**
 * Hook that returns a handler for copying selected text to clipboard.
 * Uses OSC 52 escape sequence for terminal clipboard support (including tmux).
 */
export function useSelectionClipboard(renderer: unknown): () => void {
  return useCallback(() => {
    const rendererWithSelection = renderer as {
      getSelection?: () => { getSelectedText?: () => string | null } | null;
    };
    if (rendererWithSelection.getSelection == null) {
      return;
    }
    const selection = rendererWithSelection.getSelection();
    if (selection?.getSelectedText == null) {
      return;
    }
    const text = selection.getSelectedText() ?? '';
    if (text.length === 0) {
      return;
    }
    // Send OSC 52 to terminal for clipboard
    const osc = buildOsc52(text);
    try {
      const rendererWithWrite = renderer as {
        writeOut?: (chunk: string) => void;
      };
      if (rendererWithWrite.writeOut != null) {
        rendererWithWrite.writeOut(osc);
      }
    } catch {
      // ignore renderer write failures
    }
    // Also copy via clipboardy as fallback
    void clipboard.write(text).catch(() => undefined);
  }, [renderer]);
}

function buildOsc52(text: string): string {
  const base64 = Buffer.from(text).toString('base64');
  const osc52 = `\u001b]52;c;${base64}\u0007`;
  if (process.env.TMUX) {
    return `\u001bPtmux;\u001b${osc52}\u001b\\`;
  }
  return osc52;
}
