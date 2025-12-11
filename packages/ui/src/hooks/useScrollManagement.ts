import type { RefObject, Dispatch, SetStateAction } from 'react';
import { useCallback, useState } from 'react';
import { useKeyboard } from '@vybestack/opentui-react';
import type { ScrollBoxRenderable } from '@vybestack/opentui-core';

type StateSetter<T> = Dispatch<SetStateAction<T>>;

const SCROLL_STEP = 2;
const PAGE_STEP = 10;

export interface UseScrollManagementReturn {
  autoFollow: boolean;
  setAutoFollow: StateSetter<boolean>;
  scrollBy: (delta: number) => void;
  jumpToBottom: () => void;
  handleContentChange: () => void;
  handleMouseScroll: (event: { type: string }) => void;
}

export function useScrollManagement(
  scrollRef: RefObject<ScrollBoxRenderable | null>,
): UseScrollManagementReturn {
  const [autoFollow, setAutoFollow] = useState(true);

  const scrollToBottom = useCallback(() => {
    const scrollBox = scrollRef.current;
    if (scrollBox == null) {
      return;
    }
    scrollBox.scrollTo({ x: 0, y: scrollBox.scrollHeight });
  }, [scrollRef]);

  const isAtBottom = useCallback((box: ScrollBoxRenderable): boolean => {
    const viewportHeight = box.viewport.height;
    return box.scrollTop + viewportHeight >= box.scrollHeight - 1;
  }, []);

  const scrollBy = useCallback(
    (delta: number) => {
      const scrollBox = scrollRef.current;
      if (scrollBox == null) {
        return;
      }
      scrollBox.scrollTo({ x: 0, y: scrollBox.scrollTop + delta });
      if (delta < 0) {
        setAutoFollow(false);
        return;
      }
      setAutoFollow(isAtBottom(scrollBox));
    },
    [isAtBottom, scrollRef],
  );

  const jumpToBottom = useCallback(() => {
    scrollToBottom();
    setAutoFollow(true);
  }, [scrollToBottom]);

  const handleContentChange = useCallback(() => {
    if (autoFollow) {
      scrollToBottom();
    }
  }, [autoFollow, scrollToBottom]);

  const handleMouseScroll = useCallback(
    (event: { type: string }) => {
      if (event.type !== 'scroll') {
        return;
      }
      const scrollBox = scrollRef.current;
      if (scrollBox == null) {
        return;
      }
      setAutoFollow(isAtBottom(scrollBox));
    },
    [isAtBottom, scrollRef],
  );

  useKeyboard((key) => {
    if (key.name === 'pageup' || (key.ctrl && key.name === 'up')) {
      scrollBy(-PAGE_STEP);
    } else if (key.name === 'pagedown' || (key.ctrl && key.name === 'down')) {
      scrollBy(PAGE_STEP);
    } else if (key.name === 'end') {
      jumpToBottom();
    } else if (key.name === 'home') {
      setAutoFollow(false);
      const scrollBox = scrollRef.current;
      if (scrollBox != null) {
        scrollBox.scrollTo({ x: 0, y: 0 });
      }
    } else if (key.ctrl && key.name === 'b') {
      scrollBy(-SCROLL_STEP);
    } else if (key.ctrl && key.name === 'f') {
      scrollBy(SCROLL_STEP);
    }
  });

  return {
    autoFollow,
    setAutoFollow,
    scrollBy,
    jumpToBottom,
    handleContentChange,
    handleMouseScroll,
  };
}
