import { useCallback, useEffect, useState } from 'react';

/**
 * Which screen the dashboard shows. It lives in the query string rather than in routes because
 * the site is a static export: /?vehicle=<id> can be bookmarked and shared without a server.
 */
/** Pages that are just a name, with no id. */
export const namedPages = [
  'overview',
  'live-map',
  'trips',
  'drivers',
  'alerts',
  'settings',
] as const;
export type NamedPage = (typeof namedPages)[number];

export type View = { page: NamedPage } | { page: 'vehicle'; deviceId: string };

export function parseView(search: string): View {
  const params = new URLSearchParams(search);
  const deviceId = params.get('vehicle');
  if (deviceId) return { page: 'vehicle', deviceId };
  const page = params.get('view');
  if (page && page !== 'overview' && (namedPages as readonly string[]).includes(page))
    return { page: page as NamedPage };
  return { page: 'overview' };
}

export function viewSearch(view: View): string {
  if (view.page === 'vehicle') return `?vehicle=${encodeURIComponent(view.deviceId)}`;
  if (view.page === 'overview') return '';
  return `?view=${view.page}`;
}

/** The current view, kept in step with the address bar and the browser's back/forward buttons. */
export function useView(): [View, (next: View) => void] {
  const [view, setView] = useState<View>({ page: 'overview' });
  useEffect(() => {
    const follow = () => setView(parseView(window.location.search));
    follow();
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);
  const navigate = useCallback((next: View) => {
    window.history.pushState(null, '', `${window.location.pathname}${viewSearch(next)}`);
    setView(next);
    window.scrollTo({ top: 0 });
  }, []);
  return [view, navigate];
}
