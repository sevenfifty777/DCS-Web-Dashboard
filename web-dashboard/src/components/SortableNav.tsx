"use client";

// The page list of the left panel: renders the user's visible pages in their
// chosen order, and lets them reorder (drag, or Move up/down from the
// right-click menu), hide pages, and bring hidden pages back from a footer row.
//
// Drag and drop is hand-rolled on pointer events so it works with mouse and
// touch without a dependency. With a mouse, a drag starts from the grip or by
// pressing and holding (or moving) anywhere on the item. On touch, only the
// grip starts a drag (`touch-action: none` on the grip) so that swiping the
// list still scrolls it. A plain click keeps navigating.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import ContextMenu, { type MenuItem } from './ContextMenu';
import { NAV_PAGES, isPageActive, type NavPage } from './navPages';
import {
  hidePage,
  insertionSlotFor,
  isCustomised,
  moveDown,
  moveUp,
  moveVisibleIndex,
  showPage,
  slotToIndex,
  type NavPrefs,
} from './navPrefs';
import { useNavPrefs } from './useNavPrefs';
import styles from './Sidebar.module.css';

const HOLD_MS = 150;
const MOVE_THRESHOLD_PX = 4;
const TOAST_MS = 6000;
const LIST_GAP_PX = 8;

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface DragState {
  id: string;
  from: number;
  slot: number;
  startY: number;
  pointerY: number;
  /** Height of the dragged item plus the list gap: how far neighbours shift. */
  shift: number;
}

interface PendingDrag {
  id: string;
  index: number;
  startX: number;
  startY: number;
  pointerId: number;
  timer: number | null;
}

interface Toast {
  message: string;
  undo: () => void;
}

export default function SortableNav({ pathname }: { pathname: string }) {
  const { prefs, nav, update, reset } = useNavPrefs();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hiddenRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<PendingDrag | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const didDragRef = useRef(false);
  const toastTimer = useRef<number | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  // ----- toast / undo -------------------------------------------------------

  const showToast = useCallback((message: string, undo: () => void) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ message, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  // ----- actions ------------------------------------------------------------

  const doHide = useCallback((page: NavPage) => {
    update(current => hidePage(current, page.id, NAV_PAGES));
    showToast(`${page.label} hidden`, () => update(current => showPage(current, page.id)));
  }, [update, showToast]);

  const doShow = useCallback((page: NavPage) => {
    update(current => showPage(current, page.id));
  }, [update]);

  const doReset = useCallback((previous: NavPrefs) => {
    reset();
    showToast('Panel reset to default', () => update(previous));
  }, [reset, update, showToast]);

  const revealHidden = useCallback(() => {
    setHiddenOpen(true);
    window.setTimeout(() => hiddenRef.current?.scrollIntoView({ block: 'nearest' }), 0);
  }, []);

  // ----- context menu -------------------------------------------------------

  /** Build the entries for `page` from the current prefs; called from event handlers only. */
  const menuItemsFor = (page: NavPage, hidden: boolean): MenuItem[] => {
    const customised = isCustomised(prefs, NAV_PAGES);
    const resetItem: MenuItem = {
      label: 'Reset to default',
      disabled: !customised,
      danger: true,
      onSelect: () => doReset(prefs),
    };
    if (hidden) {
      return [
        { label: 'Show', onSelect: () => doShow(page) },
        'separator',
        resetItem,
      ];
    }
    const index = nav.visible.findIndex(item => item.id === page.id);
    const items: MenuItem[] = [
      { label: 'Move up', disabled: index <= 0, onSelect: () => update(current => moveUp(current, page.id, NAV_PAGES)) },
      { label: 'Move down', disabled: index >= nav.visible.length - 1, onSelect: () => update(current => moveDown(current, page.id, NAV_PAGES)) },
    ];
    if (!page.pinned) items.push({ label: 'Hide', onSelect: () => doHide(page) });
    items.push('separator');
    if (nav.hidden.length > 0) items.push({ label: 'Show hidden pages…', onSelect: revealHidden });
    items.push(resetItem);
    return items;
  };

  const openMenuAt = (x: number, y: number, page: NavPage, hidden: boolean) => {
    setMenu({ x, y, items: menuItemsFor(page, hidden) });
  };

  const onItemKeyDown = (event: KeyboardEvent<HTMLElement>, page: NavPage, hidden: boolean) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openMenuAt(rect.left + 24, rect.bottom - 4, page, hidden);
    }
  };

  // ----- drag and drop ------------------------------------------------------

  /** Item rectangles ignoring any in-flight transforms (offsetTop is layout-only). */
  const measureRects = () => {
    const list = listRef.current;
    if (!list) return [];
    const base = list.getBoundingClientRect().top - list.scrollTop;
    return itemRefs.current.slice(0, nav.visible.length).map(el => {
      if (!el) return { top: 0, bottom: 0 };
      return { top: base + el.offsetTop, bottom: base + el.offsetTop + el.offsetHeight };
    });
  };

  const clearPending = () => {
    const pending = pendingRef.current;
    if (pending?.timer) window.clearTimeout(pending.timer);
    pendingRef.current = null;
  };

  const activateDrag = useCallback((pending: PendingDrag, pointerY: number) => {
    clearPending();
    const el = itemRefs.current[pending.index];
    const state: DragState = {
      id: pending.id,
      from: pending.index,
      slot: pending.index,
      startY: pending.startY,
      pointerY,
      shift: (el?.offsetHeight ?? 0) + LIST_GAP_PX,
    };
    dragRef.current = state;
    setDrag(state);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  }, []);

  const finishDrag = useCallback((commit: boolean) => {
    const state = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    if (!state) return;
    if (commit) {
      const to = slotToIndex(state.from, state.slot);
      if (to !== state.from) update(current => moveVisibleIndex(current, state.from, to, NAV_PAGES));
    }
  }, [update]);

  // Window-level listeners while a press is pending or a drag is active.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const pending = pendingRef.current;
      if (pending && event.pointerId === pending.pointerId) {
        const moved = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
        if (moved > MOVE_THRESHOLD_PX) activateDrag(pending, event.clientY);
        return;
      }
      const state = dragRef.current;
      if (!state) return;
      if (Math.abs(event.clientY - state.startY) > MOVE_THRESHOLD_PX) didDragRef.current = true;
      const slot = insertionSlotFor(event.clientY, measureRects());
      const next = { ...state, pointerY: event.clientY, slot };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = () => {
      clearPending();
      if (dragRef.current) finishDrag(true);
    };
    const onCancel = () => {
      clearPending();
      if (dragRef.current) finishDrag(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && dragRef.current) {
        event.preventDefault();
        finishDrag(false);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
    // measureRects reads refs and nav.visible.length; re-bind when the list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activateDrag, finishDrag, nav.visible.length]);

  const onItemPointerDown = (event: ReactPointerEvent<HTMLElement>, page: NavPage, index: number, fromGrip: boolean) => {
    if (event.button !== 0 || dragRef.current) return;
    didDragRef.current = false;
    closeMenu();
    // Touch (and pen) only drag from the grip, so swiping the list still scrolls.
    if (!fromGrip && event.pointerType !== 'mouse') return;
    if (fromGrip) event.preventDefault();
    clearPending();
    const pending: PendingDrag = {
      id: page.id,
      index,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      timer: null,
    };
    pendingRef.current = pending;
    if (fromGrip) {
      activateDrag(pending, event.clientY);
    } else {
      pending.timer = window.setTimeout(() => {
        if (pendingRef.current === pending) activateDrag(pending, pending.startY);
      }, HOLD_MS);
    }
  };

  /** Transform for the item at visible `index` while a drag is in flight. */
  const itemTransform = (index: number): string | undefined => {
    if (!drag) return undefined;
    if (index === drag.from) return `translateY(${drag.pointerY - drag.startY}px)`;
    const target = slotToIndex(drag.from, drag.slot);
    if (drag.from < index && index <= target) return `translateY(-${drag.shift}px)`;
    if (target <= index && index < drag.from) return `translateY(${drag.shift}px)`;
    return undefined;
  };

  // ----- render -------------------------------------------------------------

  const hiddenCount = nav.hidden.length;

  return (
    <>
      <div ref={listRef} className={`${styles.list} ${drag ? styles.listDragging : ''}`}>
        {nav.visible.map((page, index) => {
          const isDragged = drag?.id === page.id;
          return (
            <div
              key={page.id}
              ref={el => { itemRefs.current[index] = el; }}
              className={`${styles.item} ${isDragged ? styles.dragging : ''}`}
              style={{ transform: itemTransform(index) }}
              onPointerDown={event => onItemPointerDown(event, page, index, false)}
              onContextMenu={event => {
                event.preventDefault();
                clearPending();
                openMenuAt(event.clientX, event.clientY, page, false);
              }}
              onKeyDown={event => onItemKeyDown(event, page, false)}
            >
              <Link
                href={page.href}
                draggable={false}
                onDragStart={event => event.preventDefault()}
                onClick={event => { if (didDragRef.current) event.preventDefault(); }}
                className={`${styles.link} ${isPageActive(page, pathname) ? styles.active : ''}`}
              >
                {page.label}
              </Link>
              <span
                className={styles.grip}
                title="Drag to reorder"
                aria-hidden="true"
                onPointerDown={event => {
                  event.stopPropagation();
                  onItemPointerDown(event, page, index, true);
                }}
              >
                ⋮⋮
              </span>
            </div>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <div ref={hiddenRef} className={styles.hiddenSection}>
          <button
            type="button"
            className={styles.hiddenToggle}
            aria-expanded={hiddenOpen}
            onClick={() => setHiddenOpen(open => !open)}
          >
            <span className={styles.hiddenToggleSign}>{hiddenOpen ? '−' : '+'}</span>
            {hiddenCount} hidden page{hiddenCount === 1 ? '' : 's'}
          </button>
          {hiddenOpen && nav.hidden.map(page => (
            <div
              key={page.id}
              className={styles.hiddenRow}
              tabIndex={0}
              onContextMenu={event => {
                event.preventDefault();
                openMenuAt(event.clientX, event.clientY, page, true);
              }}
              onKeyDown={event => onItemKeyDown(event, page, true)}
            >
              <span className={styles.hiddenLabel}>{page.label}</span>
              <button type="button" className={styles.showButton} onClick={() => doShow(page)}>
                Show
              </button>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className={styles.toast} role="status">
          <span>{toast.message}</span>
          <button
            type="button"
            className={styles.toastUndo}
            onClick={() => {
              toast.undo();
              setToast(null);
            }}
          >
            Undo
          </button>
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />
      )}
    </>
  );
}
