# Left Panel Customisation Plan (reorder / hide / unhide pages)

Status: **implemented** 2026-09-06 on branch `left_panel`, going with every
recommendation in §11. §12 records what was built and where it deviates from
the sections below.

## 1. Goal

Users want to tailor the left navigation panel to the pages they actually use:

1. **Reorder** pages — move a page up or down in the list.
2. **Hide** pages they do not use, and **unhide** them again easily.
3. Reach these actions through a **right-click context menu** on a page
   (Move up / Move down / Hide).
4. **Drag and drop** a page up or down with the mouse as a faster way to reorder.

The customisation must survive a reload, must never make a page unreachable,
and must not touch the DCS server (this is purely a dashboard-UI preference).

## 2. What exists today (verified in the codebase)

| Concern | Where | Notes |
| --- | --- | --- |
| Navigation list | [Sidebar.tsx:154-170](../../web-dashboard/src/components/Sidebar.tsx#L154-L170) | 16 hard-coded `<Link>` elements, one per page, plus a Logout button |
| Active-page rule | same block | `pathname === href`, except LSO which uses `pathname.startsWith('/lso')` |
| Sidebar styling | [Sidebar.module.css](../../web-dashboard/src/components/Sidebar.module.css) | `.nav`, `.link`, `.active`; mobile drawer under 768 px |
| Mobile behaviour | [Sidebar.tsx:89](../../web-dashboard/src/components/Sidebar.tsx#L89) | hamburger opens a fixed drawer; overlay closes it |
| Layout | [layout.tsx:34-39](../../web-dashboard/src/app/layout.tsx#L34-L39) | `<Sidebar />` rendered once inside `AuthGate` for every page |
| Auth / identity | [auth.rs:24-41](../../rust-web-dashboard/src/auth.rs#L24-L41) | JWT subject is `admin` (password) or `discord_<id>` (OAuth) |
| Browser-storage precedent | [carrierPersistence.ts:77-93](../../web-dashboard/src/app/airboss/carrierPersistence.ts#L77-L93) | `loadLayout`/`saveLayout` take a `Storage`-like object, tolerate `null` and quota errors, versioned JSON |
| Test convention | `web-dashboard/src/app/airboss/*.test.ts` | `node --test`, pure helpers only, `MemoryStorage` stub for storage |
| Existing "Settings" page | [settings/page.tsx](../../web-dashboard/src/app/settings/page.tsx) | DCS `serverSettings.lua` editor, unrelated to dashboard preferences |
| Static export | `AuthGate.tsx` header comment | no server-side rendering of user state; anything read from `localStorage` must handle the prerender pass |

### 2.1 Key constraints

- **Static export, hydration.** The page is prerendered without `localStorage`.
  Reading preferences must follow the `AuthGate` pattern (read after mount, or
  `useSyncExternalStore` with a server snapshot equal to the defaults),
  otherwise React reports a hydration mismatch when the stored order differs
  from the default.
- **Right-click on a link.** Browsers open their own context menu on
  `contextmenu`; the handler must `preventDefault()`. On touch devices there is
  no right-click, so the menu needs a second entry point (see §5.3).
- **Drag on a link.** A `<Link>` is an anchor, which browsers already treat as
  draggable (they drag the URL). The drag implementation must take over that
  behaviour, and a click must still navigate when no drag happened.
- **Hidden must not mean unreachable.** Direct URLs keep working (`/lso` is
  still routable even when hidden) and there must always be a visible way back
  to the full list.

## 3. Page registry (replaces the hard-coded list)

New file `web-dashboard/src/components/navPages.ts`:

```ts
export interface NavPage {
  /** Stable identifier persisted in preferences. Never rename once shipped. */
  id: string;
  href: string;
  label: string;
  /** `exact` (default) or `prefix` — LSO has sub-routes. */
  match?: 'exact' | 'prefix';
  /** Pages that cannot be hidden (see D2). */
  pinned?: boolean;
}

export const NAV_PAGES: readonly NavPage[] = [
  { id: 'status',      href: '/',            label: 'Server Status', pinned: true },
  { id: 'mission',     href: '/mission',     label: 'Mission' },
  { id: 'weather',     href: '/weather',     label: 'Weather' },
  { id: 'triggers',    href: '/triggers',    label: 'Triggers' },
  { id: 'srs',         href: '/srs',         label: 'SRS' },
  { id: 'console',     href: '/console',     label: 'Console' },
  { id: 'players',     href: '/players',     label: 'Players' },
  { id: 'chat',        href: '/chat',        label: 'Chat' },
  { id: 'leaderboard', href: '/leaderboard', label: 'Leaderboard' },
  { id: 'settings',    href: '/settings',    label: 'Settings' },
  { id: 'access-logs', href: '/access-logs', label: 'Access Logs' },
  { id: 'foothold',    href: '/foothold',    label: 'Foothold' },
  { id: 'airboss',     href: '/airboss',     label: 'Airboss Planner' },
  { id: 'lso',         href: '/lso',         label: 'LSO', match: 'prefix' },
  { id: 'tacview',     href: '/tacview',     label: 'Tacview' },
  { id: 'tasks',       href: '/tasks',       label: 'Tasks' },
];
```

The order of this array is the **default order**. Logout stays a separate
button outside the registry: it is not a page and is never reorderable or
hideable.

Adding a page in the future = one line here. A page that is in the registry but
absent from a user's saved preferences is appended at the end, visible (§4.2).

## 4. Preference model and persistence

### 4.1 Shape

```ts
export interface NavPrefs {
  version: 1;
  /** Page ids in display order. Ids unknown to the registry are dropped. */
  order: string[];
  /** Page ids the user hid. */
  hidden: string[];
}
```

Stored as JSON under one `localStorage` key: `dashboard:nav:v1`.

### 4.2 Reconciliation (`resolveNav(prefs, NAV_PAGES)`)

A pure function, unit-tested, that turns stored prefs plus the registry into the
list to render:

1. Walk `prefs.order`; keep ids that exist in the registry, in that order.
2. Append every registry page not yet placed, in registry order (handles new
   pages added after the user saved, and the very first run).
3. Mark `hidden` for ids in `prefs.hidden` that exist and are not `pinned`.
4. Output `{ visible: NavPage[], hidden: NavPage[] }`.

Malformed JSON, a wrong `version`, or a missing key all resolve to the default
order with nothing hidden. Storage errors on write are swallowed (same as
`saveLayout`).

### 4.3 Where preferences live — options

| Option | Scope | Pros | Cons |
| --- | --- | --- | --- |
| **(A) `localStorage` only** (recommended for v1) | per browser | zero backend, no auth changes, matches the Airboss layout precedent, works offline | not shared between the user's devices; cleared with site data |
| (B) Backend per-user preferences: `GET/PUT /api/prefs/nav` keyed by JWT subject, stored in a JSON file next to `audit_logs.json` | per login | follows the user across browsers; admins could reset it | new Rust routes + file + OpenAPI; `admin` password logins all share one subject so they share one layout; needs a fallback when offline |
| (C) A + B hybrid: local cache, sync to backend when available | per login, cached | best UX | most code; conflict rules on two devices editing at once |

**Recommendation: (A) now**, with `NavPrefs` versioned and the load/save
functions taking a `Storage`-like interface, so (B) can be layered later
without touching the sidebar component. **Decision D1.**

## 5. Interaction design

### 5.1 Right-click context menu

- `onContextMenu` on each nav item: `preventDefault()`, open a small floating
  menu positioned at the cursor (clamped to the viewport).
- Entries, in this order:
  - **Move up** (disabled on the first visible item)
  - **Move down** (disabled on the last visible item)
  - **Hide** (absent on `pinned` pages)
  - separator
  - **Show hidden pages…** (only when at least one page is hidden) — opens the
    unhide UI (§5.3)
  - **Reset to default** — restores default order and unhides everything
- Closes on: choosing an entry, `Escape`, click anywhere else, scroll, window
  resize, or route change.
- Keyboard: the menu is a `role="menu"` with `role="menuitem"` entries, arrow
  keys move focus, `Enter` activates. Trigger via `Shift+F10` or the context-menu
  key on a focused link, for parity with the native menu.
- Implemented as a small `ContextMenu.tsx` component (no library), styled like
  the existing panels (`var(--panel-bg)`, `var(--panel-border)`, mono font,
  hover in `rgba(0,212,255,0.1)`).

### 5.2 Move up / down

Pure helpers `moveUp(order, id)` / `moveDown(order, id)` operate on the
**visible** list only, so a hidden page in between is not skipped over
surprisingly: moving "Players" up past a hidden "Console" puts Players before
Console in `order` as well. Result is written to `order` and saved
immediately. No Save button; the change is instant and reversible.

### 5.3 Hide / unhide

- **Hide** removes the page from the visible list at once. If the user is
  currently *on* that page it stays open (nothing navigates away); the sidebar
  simply no longer lists it. A short toast-style line under the list —
  *"Foothold hidden · Undo"* — for ~6 s gives an immediate way back
  (**D3**: keep or drop the undo line).
- **Unhide**, two entry points so it is always discoverable:
  1. A permanent footer row in the nav, shown only when something is hidden:
     `+ 3 hidden pages`. Clicking it expands an inline list of the hidden pages,
     each with a **Show** button and its own right-click menu (Show / Reset).
     This also works on touch devices, where there is no right-click.
  2. The **Show hidden pages…** entry in the context menu (§5.1), which jumps
     to and expands the same footer row.
- Pinned pages (`Server Status`, see **D2**) never show a Hide entry, so the
  list can never become empty.

### 5.4 Drag and drop reorder

Two viable implementations; the plan recommends the first.

| Option | How | Pros | Cons |
| --- | --- | --- | --- |
| **(A) Pointer events, hand-rolled** (recommended) | `onPointerDown` on a drag handle or on the item after a 150 ms hold; track `pointermove`, compute the drop index from item midpoints, render a placeholder; `onPointerUp` commits | no dependency (package.json currently has no UI libs), works with mouse **and** touch, full control over the look, small (~120 lines) | must handle the click-vs-drag distinction ourselves (movement threshold of 4 px + hold) |
| (B) HTML5 Drag-and-Drop API (`draggable`, `onDragStart`/`onDragOver`/`onDrop`) | native events | very little code | no touch support on most mobile browsers, ugly native ghost image, fights the anchor's own URL-drag behaviour |
| (C) A library (`@dnd-kit/core` + `@dnd-kit/sortable`) | battle-tested sortable list | accessibility and keyboard sorting for free | +2 dependencies (~30 kB), first UI library in the project, more to learn for a 16-item list |

Details for (A):

- Drag starts only from a small **grip** (`⋮⋮`) shown at the right of each item
  on hover, **or** after a press-and-hold anywhere on the item (**D4**: grip
  only, hold only, or both). Starting from the grip means a plain click on the
  label still navigates without any delay.
- While dragging: the dragged item gets `opacity: .5` and follows the pointer
  (a `position: fixed` clone), the other items shift with a CSS transform so the
  gap shows where it will land, `user-select: none` and `touch-action: none` are
  applied to the list for the duration, and `setPointerCapture` keeps events
  flowing when the cursor leaves the sidebar.
- On release: if the drop index differs from the start index, write the new
  `order` and save. If the pointer moved less than 4 px it is treated as a click.
- `Escape` cancels a drag in progress.
- Drag is enabled on the mobile drawer too (touch + hold), since the grip has
  no hover state there.

### 5.5 Reset

**Reset to default** in the context menu clears the stored key and re-renders
the registry order. A confirm step is unnecessary since it is one right-click
away from re-doing any change, but the toast line offers *Undo* for ~6 s.

## 6. Component structure

```
components/
  navPages.ts          registry + NavPage type            (pure, tested)
  navPrefs.ts          NavPrefs, load/save, resolveNav,
                       moveUp/moveDown, hide/unhide, reset (pure, tested)
  useNavPrefs.ts       React hook: useSyncExternalStore over localStorage,
                       server snapshot = defaults, cross-tab `storage` event
  ContextMenu.tsx      generic positioned menu, keyboard + outside-click
  SortableNav.tsx      the list: renders visible pages, owns drag state,
                       hidden-pages footer, toast/undo line
  Sidebar.tsx          unchanged header/status cards; `<SortableNav/>` replaces
                       the 16 hard-coded links
  Sidebar.module.css   + .grip, .dragging, .placeholder, .hiddenFooter,
                       .menu, .menuItem, .toast
```

`Sidebar.tsx` keeps the RDP and mission status cards and the Logout button
exactly as they are; the only removal is the `<Link>` block.

## 7. Accessibility and edge cases

- Every nav item stays a real `<a>` so middle-click and "open in new tab" work.
- Context menu is reachable from the keyboard (`Shift+F10`) and drag has a
  keyboard alternative (Move up/down in the menu), so no function is
  mouse-only.
- The hidden-pages footer has `aria-expanded`.
- If **all** non-pinned pages are hidden the list shows the pinned page plus the
  footer — still navigable.
- Cross-tab: a `storage` event re-reads prefs, so two open tabs stay in sync.
- The active-page highlight uses the registry's `match` rule, so the LSO prefix
  case is preserved.
- Old browsers without `PointerEvent` (none in scope for a 2026 admin tool)
  would simply not drag; menu-based moves still work.

## 8. Documentation

1. **[features.md](features.md)** — new short section *"Customising the left
   panel"*: right-click menu, drag to reorder, hidden-pages footer, reset, and
   the note that preferences are per browser (until D1 changes).
2. **[SUMMARY.md](SUMMARY.md)** — link this plan while it is live.
3. No REST API or OpenAPI change under option (A).

## 9. Implementation steps (ordered)

Each step builds and is independently reviewable.

1. **Registry** — `navPages.ts`; refactor `Sidebar.tsx` to render from it with
   no behaviour change. `npm run build` + eyeball. (Safe first commit.)
2. **Prefs model** — `navPrefs.ts` with `loadNavPrefs`, `saveNavPrefs`,
   `resolveNav`, `moveUp`, `moveDown`, `hidePage`, `showPage`, `resetNav`;
   `navPrefs.test.ts` (§10).
3. **Hook** — `useNavPrefs.ts` (`useSyncExternalStore`, default snapshot on the
   server pass, `storage` event subscription). Sidebar renders the resolved
   visible list; still no UI to change it. Verify no hydration warning.
4. **Context menu** — `ContextMenu.tsx` + Move up / Move down / Hide / Reset
   wiring. Keyboard handling.
5. **Hidden-pages footer** with Show buttons, plus the *Show hidden pages…*
   menu entry. Toast/undo line if D3 = yes.
6. **Drag and drop** — pointer-event sorting in `SortableNav.tsx`; grip
   and/or hold per D4; placeholder styling; Escape cancels.
7. **Mobile pass** — drawer at < 768 px: hold-to-drag, footer reachable,
   menu positioned inside the viewport.
8. **Docs** — features.md, SUMMARY.md.
9. **Build check** — `npm run build` in `web-dashboard/`, then
   `cargo build --release` (the static export is embedded by `rust-embed`).
10. **Manual verification** (§10.2), commit on `left_panel`, open the PR.

Estimated size: ~450 lines of TypeScript/TSX and ~80 lines of CSS, no new
dependencies under 5.4 (A).

## 10. Tests

### 10.1 Unit tests (`node --test "src/components/*.test.ts"`)

`navPrefs.test.ts`, using the `MemoryStorage` stub pattern from
`carrierPersistence.test.ts`:

- `resolveNav` with empty prefs → registry order, nothing hidden.
- Unknown ids in `order` are dropped; registry pages missing from `order` are
  appended in registry order.
- `hidden` containing a pinned id is ignored.
- `moveUp` on the first item and `moveDown` on the last are no-ops; moving
  past a hidden neighbour reorders relative to it correctly.
- `hidePage` / `showPage` round-trip; `resetNav` clears the key.
- Wrong `version`, malformed JSON, `null` storage, and a throwing storage all
  resolve to defaults without throwing.

The drag maths (`dropIndexFor(pointerY, itemRects)`) is extracted as a pure
function and tested with synthetic rectangles.

### 10.2 Manual verification checklist

1. Fresh browser: list matches today's order, no hydration warning in the
   console.
2. Right-click *Players* → Move up → it swaps with *Console*; reload → persists.
3. Right-click *Foothold* → Hide → disappears; footer shows `+ 1 hidden page`;
   navigating directly to `/foothold` still works and highlights nothing in
   the list.
4. Footer → Show → *Foothold* returns at its previous position.
5. Right-click *Server Status* → no Hide entry.
6. Drag *Tacview* to the top with the mouse → list reorders; reload → persists.
7. Plain click on a label (no movement) still navigates; middle-click opens a
   new tab.
8. Phone or DevTools touch emulation: open drawer, press-and-hold to drag,
   footer Show works, no right-click needed.
9. Two tabs open: change order in one → the other updates.
10. Reset to default → original order, nothing hidden, key removed from
    `localStorage`.
11. `Shift+F10` on a focused link opens the menu; arrow keys and Enter work.

## 11. Decisions for review

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | Where preferences are stored | (A) `localStorage` per browser · (B) backend per JWT subject · (C) both | **A** for v1, model kept backend-ready |
| D2 | Which pages are pinned (cannot be hidden) | none · only *Server Status* · *Server Status* + *Settings* | **Only *Server Status*** — guarantees a non-empty list; everything else is the user's call |
| D3 | Undo line after Hide / Reset (~6 s) | yes · no (footer is enough) | **Yes** — cheap, and it makes an accidental hide painless |
| D4 | How a drag starts | grip handle only · press-and-hold anywhere · both | **Both** — grip for desktop precision, hold for touch |
| D5 | Drag implementation | (A) pointer events, no dependency · (B) HTML5 DnD · (C) `@dnd-kit` | **A** |
| D6 | Hidden pages footer placement | bottom of the nav list, above Logout · inside the context menu only | **Footer above Logout**, plus the menu entry |
| D7 | Should hiding a page also stop its background polling? | no (out of scope) · yes | **No** — pages only poll while open; the sidebar's own RDP/mission polling is unchanged. Revisit with the server-load work if wanted |
| D8 | Include *Reset to default* in the context menu | yes · only in the footer | **Yes**, in both |

All eight answered with the recommendation on 2026-09-06.

## 12. What was built

All files under `web-dashboard/src/components/`:

| File | Role |
| --- | --- |
| [navPages.ts](../../web-dashboard/src/components/navPages.ts) | The registry (§3) plus `isPageActive` |
| [navPrefs.ts](../../web-dashboard/src/components/navPrefs.ts) | `NavPrefs`, load/save/clear, `resolveNav`, `moveUp`/`moveDown`, `moveVisibleIndex` (drag), `hidePage`/`showPage`, `isCustomised`, `insertionSlotFor`/`slotToIndex` (drag maths) |
| [navPrefs.test.ts](../../web-dashboard/src/components/navPrefs.test.ts) | 14 node:test cases covering §10.1 — run with `node --test "src/components/*.test.ts"` |
| [useNavPrefs.ts](../../web-dashboard/src/components/useNavPrefs.ts) | `useSyncExternalStore` hook: defaults on the prerender pass, cross-tab `storage` sync, cached snapshot |
| [ContextMenu.tsx](../../web-dashboard/src/components/ContextMenu.tsx) | Positioned `role="menu"`, viewport clamping, arrow keys, Escape/outside-click/scroll close |
| [SortableNav.tsx](../../web-dashboard/src/components/SortableNav.tsx) | The list: drag, menu wiring, hidden-pages footer, undo line |
| [Sidebar.tsx](../../web-dashboard/src/components/Sidebar.tsx) | The 16 hard-coded links replaced by `<SortableNav/>`; status cards and Logout untouched |
| [Sidebar.module.css](../../web-dashboard/src/components/Sidebar.module.css) | Item/grip/drag, footer, toast and menu styles |

### Deviations from the plan as written

- **Touch drag is grip-only** (§5.4 said hold-anywhere on the drawer too).
  A browser decides at touch start whether a gesture pans, so hold-to-drag on
  the whole item would have needed `touch-action: none` on every item and the
  drawer could no longer be scrolled by swiping. The grip carries
  `touch-action: none` and is always visible under 768 px instead. With a
  mouse, both press-and-hold and moving more than 4 px start a drag, as
  planned.
- **The pure helpers take the page list as a parameter** rather than
  defaulting to `NAV_PAGES`. The node test runner resolves extension-less
  imports only for type imports, and the existing tested modules follow the
  same rule; the hook and the component pass `NAV_PAGES` explicitly.
- **The menu's entries are built when it opens**, not on every render, so the
  React Compiler lint (no ref access during render) is satisfied.
- No auto-scroll of the list while dragging near its edge; the list fits on
  every desktop viewport and the menu's Move up/down covers the rest.
