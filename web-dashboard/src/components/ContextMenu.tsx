"use client";

// Small floating menu opened at a screen position (right-click or Shift+F10).
// No library: a positioned `role="menu"` with arrow-key navigation that closes
// on Escape, outside click, scroll, resize, or when an item is chosen.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import styles from './Sidebar.module.css';

export interface MenuEntry {
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Draw in the danger colour (used for Reset). */
  danger?: boolean;
}

export type MenuItem = MenuEntry | 'separator';

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const MARGIN = 6;

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [focusIndex, setFocusIndex] = useState<number>(-1);

  const entries = items
    .map((item, index) => ({ item, index }))
    .filter((pair): pair is { item: MenuEntry; index: number } => pair.item !== 'separator' && !pair.item.disabled);

  // Clamp into the viewport once the menu has a size.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(x, window.innerWidth - rect.width - MARGIN));
    const top = Math.max(MARGIN, Math.min(y, window.innerHeight - rect.height - MARGIN));
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (entries.length === 0) return;
        setFocusIndex(current => {
          const position = entries.findIndex(entry => entry.index === current);
          const step = event.key === 'ArrowDown' ? 1 : -1;
          const next = (position + step + entries.length) % entries.length;
          return entries[next].index;
        });
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose, entries]);

  // Move DOM focus to the highlighted entry so Enter/Space activate it.
  useEffect(() => {
    if (focusIndex < 0) {
      ref.current?.focus();
      return;
    }
    const button = ref.current?.querySelector<HTMLButtonElement>(`[data-index="${focusIndex}"]`);
    button?.focus();
  }, [focusIndex]);

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      className={styles.menu}
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={event => event.preventDefault()}
    >
      {items.map((item, index) => item === 'separator' ? (
        <div key={`sep-${index}`} className={styles.menuSeparator} role="separator" />
      ) : (
        <button
          key={index}
          type="button"
          role="menuitem"
          data-index={index}
          disabled={item.disabled}
          className={`${styles.menuItem} ${item.danger ? styles.menuItemDanger : ''}`}
          onMouseEnter={() => { if (!item.disabled) setFocusIndex(index); }}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
