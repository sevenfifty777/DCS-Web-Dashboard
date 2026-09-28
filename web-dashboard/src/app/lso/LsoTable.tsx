"use client";

// Pass table shared by the greenie board and the per-pilot page, with the same
// customisation the left panel offers:
//
// - click a column name to sort (ascending, descending, then back to the
//   default newest-first order);
// - drag a column header sideways to move the column (mouse), or use the
//   right-click header menu / the Columns dropdown (any pointer, keyboard);
// - hide a column from its header menu or the Columns dropdown, and bring it
//   back from either.
//
// Drag and drop is hand-rolled on pointer events like `components/SortableNav`.
// A header drag starts once the mouse moves a few pixels with the button down,
// so a plain click still sorts. On touch, swiping the header scrolls the table
// instead; the long-press context menu and the Columns dropdown cover moving.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import ContextMenu, { type MenuItem } from '@/components/ContextMenu';
import styles from './page.module.css';
import {
  cycleSort,
  fullOrder,
  hideColumn,
  insertionSlotForX,
  isCustomised,
  moveInOrder,
  moveVisible,
  moveVisibleIndex,
  setSort,
  showColumn,
  slotToIndex,
  sortRows,
  type TableSpec,
} from './columnPrefs';
import { LSO_COLUMNS } from './lsoColumns';
import type { LsoPass } from './lsoGrades';
import { useColumnPrefs } from './useColumnPrefs';

const MOVE_THRESHOLD_PX = 4;
const EDGE_SCROLL_PX = 48;
const EDGE_SCROLL_STEP = 24;

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface DragState {
  id: string;
  from: number;
  slot: number;
  pointerX: number;
  pointerY: number;
  /** Drop marker geometry in viewport pixels, measured in the pointer handlers. */
  marker: { left: number; top: number; height: number } | null;
}

interface PendingDrag {
  id: string;
  index: number;
  startX: number;
  startY: number;
  pointerId: number;
}

interface LsoTableProps {
  spec: TableSpec;
  /** Rows in server order (newest first); sorting never mutates this array. */
  passes: LsoPass[];
  /** Pass number for the `#` column, from the row's position in `passes`. */
  indexOf: (position: number) => number;
  onSelect: (pass: LsoPass) => void;
  emptyMessage: string;
  wrapClassName?: string;
}

export function LsoTable({ spec, passes, indexOf, onSelect, emptyMessage, wrapClassName }: LsoTableProps) {
  const { prefs, columns, update, reset } = useColumnPrefs(spec);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const headerRefs = useRef<(HTMLTableCellElement | null)[]>([]);
  const pendingRef = useRef<PendingDrag | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const didDragRef = useRef(false);

  const visible = columns.visible;
  const closeMenu = useCallback(() => setMenu(null), []);

  const rows = useMemo(() => {
    const indexed = passes.map((pass, position) => ({ pass, ctx: { index: indexOf(position) } }));
    const sort = prefs.sort;
    const column = sort && visible.includes(sort.id) ? LSO_COLUMNS[sort.id] : undefined;
    if (!sort || !column) return indexed;
    return sortRows(indexed, (row) => column.sortValue(row.pass, row.ctx), sort.dir);
  }, [passes, indexOf, prefs.sort, visible]);

  // ----- header menu --------------------------------------------------------

  /** Build the entries for column `id` from the current prefs; called from event handlers only. */
  const menuItemsFor = (id: string): MenuItem[] => {
    const index = visible.indexOf(id);
    const sortedHere = prefs.sort?.id === id ? prefs.sort.dir : null;
    const items: MenuItem[] = [
      { label: 'Sort ascending', disabled: sortedHere === 'asc', onSelect: () => update(c => setSort(c, { id, dir: 'asc' })) },
      { label: 'Sort descending', disabled: sortedHere === 'desc', onSelect: () => update(c => setSort(c, { id, dir: 'desc' })) },
      { label: 'Clear sort', disabled: prefs.sort === null, onSelect: () => update(c => setSort(c, null)) },
      'separator',
      { label: 'Move left', disabled: index <= 0, onSelect: () => update(c => moveVisible(c, id, -1, spec)) },
      { label: 'Move right', disabled: index >= visible.length - 1, onSelect: () => update(c => moveVisible(c, id, 1, spec)) },
      { label: 'Hide column', disabled: visible.length <= 1, onSelect: () => update(c => hideColumn(c, id, spec)) },
    ];
    if (columns.hidden.length > 0) {
      items.push('separator');
      for (const hiddenId of columns.hidden) {
        items.push({ label: `Show “${LSO_COLUMNS[hiddenId].label}”`, onSelect: () => update(c => showColumn(c, hiddenId)) });
      }
    }
    items.push('separator', {
      label: 'Reset columns',
      danger: true,
      disabled: !isCustomised(prefs, spec),
      onSelect: reset,
    });
    return items;
  };

  const onHeaderKeyDown = (event: KeyboardEvent<HTMLElement>, id: string) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({ x: rect.left + 8, y: rect.bottom, items: menuItemsFor(id) });
    }
  };

  // ----- drag and drop ------------------------------------------------------

  const measureRects = () => headerRefs.current.slice(0, visible.length).map(el => {
    const rect = el?.getBoundingClientRect();
    return { left: rect?.left ?? 0, right: rect?.right ?? 0 };
  });

  /** Where the drop marker for `slot` goes: the left edge of that column, or the last column's right edge. */
  const markerFor = (slot: number, rects: { left: number; right: number }[]): DragState['marker'] => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!wrap || rects.length === 0) return null;
    const x = slot < rects.length ? rects[slot].left : rects[rects.length - 1].right;
    return { left: Math.min(Math.max(x, wrap.left), wrap.right - 2), top: wrap.top, height: wrap.height };
  };

  const activateDrag = (pending: PendingDrag, pointerX: number, pointerY: number) => {
    pendingRef.current = null;
    didDragRef.current = true;
    const state: DragState = {
      id: pending.id,
      from: pending.index,
      slot: pending.index,
      pointerX,
      pointerY,
      marker: markerFor(pending.index, measureRects()),
    };
    dragRef.current = state;
    setDrag(state);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  };

  const finishDrag = useCallback((commit: boolean) => {
    const state = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    if (!state || !commit) return;
    const to = slotToIndex(state.from, state.slot);
    if (to !== state.from) update(c => moveVisibleIndex(c, state.from, to, spec));
  }, [update, spec]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const pending = pendingRef.current;
      if (pending && event.pointerId === pending.pointerId) {
        const moved = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
        if (moved > MOVE_THRESHOLD_PX) activateDrag(pending, event.clientX, event.clientY);
        return;
      }
      const state = dragRef.current;
      if (!state) return;
      // Scroll the table sideways when the pointer nears an edge, so a column
      // can travel past what is on screen.
      const wrap = wrapRef.current;
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        if (event.clientX < rect.left + EDGE_SCROLL_PX) wrap.scrollLeft -= EDGE_SCROLL_STEP;
        else if (event.clientX > rect.right - EDGE_SCROLL_PX) wrap.scrollLeft += EDGE_SCROLL_STEP;
      }
      const rects = measureRects();
      const slot = insertionSlotForX(event.clientX, rects);
      const next = { ...state, pointerX: event.clientX, pointerY: event.clientY, slot, marker: markerFor(slot, rects) };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = () => {
      pendingRef.current = null;
      if (dragRef.current) finishDrag(true);
    };
    const onCancel = () => {
      pendingRef.current = null;
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
    // activateDrag/measureRects read refs and visible.length; re-bind when the columns change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishDrag, visible.length]);

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLElement>, id: string, index: number) => {
    didDragRef.current = false;
    if (event.button !== 0 || event.pointerType !== 'mouse' || dragRef.current) return;
    closeMenu();
    pendingRef.current = {
      id,
      index,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
    };
  };

  // ----- render -------------------------------------------------------------

  return (
    <div ref={wrapRef} className={wrapClassName ?? styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {visible.map((id, index) => {
              const column = LSO_COLUMNS[id];
              const sortDir = prefs.sort?.id === id ? prefs.sort.dir : null;
              return (
                <th
                  key={id}
                  ref={el => { headerRefs.current[index] = el; }}
                  className={`${styles.sortableHeader} ${drag?.id === id ? styles.headerDragging : ''}`}
                  aria-sort={sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : 'none'}
                  title={column.title}
                  onPointerDown={event => onHeaderPointerDown(event, id, index)}
                  onContextMenu={event => {
                    event.preventDefault();
                    pendingRef.current = null;
                    setMenu({ x: event.clientX, y: event.clientY, items: menuItemsFor(id) });
                  }}
                >
                  <button
                    type="button"
                    className={`${styles.sortButton} ${sortDir ? styles.sortActive : ''}`}
                    onClick={() => {
                      if (didDragRef.current) return;
                      update(c => cycleSort(c, id));
                    }}
                    onKeyDown={event => onHeaderKeyDown(event, id)}
                    aria-label={`${column.label}: sort${sortDir ? ` (${sortDir === 'asc' ? 'ascending' : 'descending'})` : ''}. Right-click or Shift+F10 for column options.`}
                  >
                    {column.label}
                    <span className={styles.sortIcon} aria-hidden="true">
                      {sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : '↕'}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={visible.length} className={styles.empty}>{emptyMessage}</td>
            </tr>
          ) : (
            rows.map(({ pass, ctx }) => (
              <tr
                key={pass.id}
                className={styles.row}
                tabIndex={0}
                onClick={() => onSelect(pass)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(pass);
                  }
                }}
                title="Open trap sheet"
              >
                {visible.map(id => {
                  const column = LSO_COLUMNS[id];
                  return (
                    <td key={id} className={column.cellClass?.(pass)} title={column.cellTitle?.(pass)}>
                      {column.render(pass, ctx)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {drag?.marker && (
        <div className={styles.dropMarker} style={drag.marker} aria-hidden="true" />
      )}
      {drag && (
        <div
          className={styles.dragGhost}
          style={{ left: drag.pointerX + 12, top: drag.pointerY + 12 }}
          aria-hidden="true"
        >
          {LSO_COLUMNS[drag.id].label}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </div>
  );
}

/**
 * Toolbar dropdown listing every column of a table: tick to show or hide,
 * arrows to move, and a reset. Shares its setting with the table through
 * `useColumnPrefs`, so it can sit anywhere on the page.
 */
export function ColumnsMenu({ spec }: { spec: TableSpec }) {
  const { prefs, columns, update, reset } = useColumnPrefs(spec);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const order = fullOrder(prefs, spec);
  const hidden = new Set(columns.hidden);
  const hiddenCount = columns.hidden.length;

  return (
    <div ref={rootRef} className={styles.columnsRoot}>
      <button
        type="button"
        className={styles.navLink}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(value => !value)}
      >
        Columns{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''} ▾
      </button>
      {open && (
        <div className={styles.columnsPanel} role="dialog" aria-label="Table columns">
          <ul className={styles.columnsList}>
            {order.map((id, index) => {
              const column = LSO_COLUMNS[id];
              const isHidden = hidden.has(id);
              const lastVisible = !isHidden && columns.visible.length <= 1;
              return (
                <li key={id} className={`${styles.columnsRow} ${isHidden ? styles.columnsRowHidden : ''}`}>
                  <label className={styles.columnsLabel}>
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      disabled={lastVisible}
                      onChange={() => update(c => (isHidden ? showColumn(c, id) : hideColumn(c, id, spec)))}
                    />
                    {column.label}
                  </label>
                  <button
                    type="button"
                    className={styles.columnsArrow}
                    disabled={index === 0}
                    aria-label={`Move ${column.label} left`}
                    title="Move left"
                    onClick={() => update(c => moveInOrder(c, id, -1, spec))}
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    className={styles.columnsArrow}
                    disabled={index === order.length - 1}
                    aria-label={`Move ${column.label} right`}
                    title="Move right"
                    onClick={() => update(c => moveInOrder(c, id, 1, spec))}
                  >
                    ▶
                  </button>
                </li>
              );
            })}
          </ul>
          <div className={styles.columnsFooter}>
            <span className={styles.columnsHint}>Drag a header to move it; click it to sort.</span>
            <button
              type="button"
              className={styles.columnsReset}
              disabled={!isCustomised(prefs, spec)}
              onClick={reset}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
