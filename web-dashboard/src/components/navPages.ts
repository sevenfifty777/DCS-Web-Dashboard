// Registry of the pages listed in the left panel.
//
// The array order is the default display order. Each page has a stable `id`
// that is persisted in the user's navigation preferences (see navPrefs.ts), so
// ids must never be renamed once shipped — change `label` or `href` instead.
// Adding a page is one line here; a page missing from a user's saved order is
// appended at the end, visible.

export interface NavPage {
  /** Stable identifier persisted in preferences. Never rename once shipped. */
  id: string;
  href: string;
  label: string;
  /** How the active-page highlight matches the current path. Default `exact`. */
  match?: 'exact' | 'prefix';
  /** Pinned pages cannot be hidden, so the list can never become empty. */
  pinned?: boolean;
}

export const NAV_PAGES: readonly NavPage[] = [
  { id: 'status', href: '/', label: 'Server Status', pinned: true },
  { id: 'mission', href: '/mission', label: 'Mission' },
  { id: 'weather', href: '/weather', label: 'Weather' },
  { id: 'triggers', href: '/triggers', label: 'Triggers' },
  { id: 'srs', href: '/srs', label: 'SRS' },
  { id: 'console', href: '/console', label: 'Console' },
  { id: 'players', href: '/players', label: 'Players' },
  { id: 'chat', href: '/chat', label: 'Chat' },
  { id: 'leaderboard', href: '/leaderboard', label: 'Leaderboard' },
  { id: 'settings', href: '/settings', label: 'Settings' },
  { id: 'access-logs', href: '/access-logs', label: 'Access Logs' },
  { id: 'foothold', href: '/foothold', label: 'Foothold' },
  { id: 'airboss', href: '/airboss', label: 'Airboss Planner' },
  { id: 'lso', href: '/lso', label: 'LSO', match: 'prefix' },
  { id: 'tacview', href: '/tacview', label: 'Tacview' },
  { id: 'tasks', href: '/tasks', label: 'Tasks' },
];

/** Does `pathname` count as being "on" this page for the active highlight? */
export function isPageActive(page: NavPage, pathname: string): boolean {
  if (page.match === 'prefix') return pathname.startsWith(page.href);
  return pathname === page.href;
}
