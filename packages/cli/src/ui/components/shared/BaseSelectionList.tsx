/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import { Text, Box } from 'ink';
import { theme } from '../../semantic-colors.js';
import { useSelectionList } from '../../hooks/useSelectionList.js';

import type { SelectionListItem } from '../../hooks/useSelectionList.js';

export interface RenderItemContext {
  isSelected: boolean;
  titleColor: string;
  numberColor: string;
}

export interface BaseSelectionListProps<
  T,
  TItem extends SelectionListItem<T> = SelectionListItem<T>,
> {
  items: TItem[];
  initialIndex?: number;
  onSelect: (value: T) => void;
  onHighlight?: (value: T) => void;
  isFocused?: boolean;
  showNumbers?: boolean;
  showScrollArrows?: boolean;
  maxItemsToShow?: number;
  renderItem: (item: TItem, context: RenderItemContext) => React.ReactNode;
}

function getItemColors(
  isSelected: boolean,
  isFocused: boolean,
  showNumbers: boolean,
  isDisabled: boolean,
): { titleColor: string; numberColor: string } {
  let titleColor = theme.text.primary;
  let numberColor = theme.text.primary;

  if (isSelected) {
    titleColor = theme.status.success;
    numberColor = theme.status.success;
  } else if (isDisabled) {
    titleColor = theme.text.secondary;
    numberColor = theme.text.secondary;
  }

  if (!isFocused && !isDisabled) {
    numberColor = theme.text.secondary;
  }

  if (!showNumbers) {
    numberColor = theme.text.secondary;
  }

  return { titleColor, numberColor };
}

function SelectionItemRow<T, TItem extends SelectionListItem<T>>({
  item,
  itemIndex,
  isSelected,
  isFocused,
  showNumbers,
  numberColumnWidth,
  renderItem,
}: {
  item: TItem;
  itemIndex: number;
  isSelected: boolean;
  isFocused: boolean;
  showNumbers: boolean;
  numberColumnWidth: number;
  renderItem: (item: TItem, context: RenderItemContext) => React.ReactNode;
}): React.JSX.Element {
  const { titleColor, numberColor } = getItemColors(
    isSelected,
    isFocused,
    showNumbers,
    item.disabled === true,
  );

  const itemNumberText = `${String(itemIndex + 1).padStart(numberColumnWidth)}.`;

  return (
    <Box alignItems="flex-start">
      <Box minWidth={2} flexShrink={0}>
        <Text
          color={isSelected ? theme.status.success : theme.text.primary}
          aria-hidden
        >
          {isSelected ? '●' : ' '}
        </Text>
      </Box>

      {showNumbers && (
        <Box
          marginRight={1}
          flexShrink={0}
          minWidth={itemNumberText.length}
          aria-checked={isSelected}
        >
          <Text color={numberColor}>{itemNumberText}</Text>
        </Box>
      )}

      <Box flexGrow={1}>
        {renderItem(item, { isSelected, titleColor, numberColor })}
      </Box>
    </Box>
  );
}

function getStableKey<T>(value: T, itemIndex: number): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : `item-${itemIndex}`;
}

export function BaseSelectionList<
  T,
  TItem extends SelectionListItem<T> = SelectionListItem<T>,
>({
  items,
  initialIndex = 0,
  onSelect,
  onHighlight,
  isFocused = true,
  showNumbers = true,
  showScrollArrows = false,
  maxItemsToShow = 10,
  renderItem,
}: BaseSelectionListProps<T, TItem>): React.JSX.Element {
  const { activeIndex } = useSelectionList({
    items,
    initialIndex,
    onSelect,
    onHighlight,
    isFocused,
    showNumbers,
  });

  const [scrollOffset, setScrollOffset] = useState(0);

  useEffect(() => {
    const newScrollOffset = Math.max(
      0,
      Math.min(activeIndex - maxItemsToShow + 1, items.length - maxItemsToShow),
    );
    if (activeIndex < scrollOffset) {
      setScrollOffset(activeIndex);
    } else if (activeIndex >= scrollOffset + maxItemsToShow) {
      setScrollOffset(newScrollOffset);
    }
  }, [activeIndex, items.length, scrollOffset, maxItemsToShow]);

  const visibleItems = items.slice(scrollOffset, scrollOffset + maxItemsToShow);
  const numberColumnWidth = String(items.length).length;

  return (
    <Box flexDirection="column">
      {showScrollArrows && (
        <Text
          color={scrollOffset > 0 ? theme.text.primary : theme.text.secondary}
        >
          ▲
        </Text>
      )}

      {visibleItems.map((item, index) => {
        const itemIndex = scrollOffset + index;
        const isSelected = activeIndex === itemIndex;
        return (
          <Box key={item.key || getStableKey(item.value, itemIndex)}>
            <SelectionItemRow
              item={item}
              itemIndex={itemIndex}
              isSelected={isSelected}
              isFocused={isFocused}
              showNumbers={showNumbers}
              numberColumnWidth={numberColumnWidth}
              renderItem={renderItem}
            />
          </Box>
        );
      })}

      {showScrollArrows && (
        <Text
          color={
            scrollOffset + maxItemsToShow < items.length
              ? theme.text.primary
              : theme.text.secondary
          }
        >
          ▼
        </Text>
      )}
    </Box>
  );
}
