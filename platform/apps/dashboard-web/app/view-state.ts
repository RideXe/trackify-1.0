import { useCallback, useEffect, useState } from 'react';

/**
 * Which screen the dashboard shows. It lives in the query string rather than in routes because
 * the site is a static export: /?vehicle=<id> can be bookmarked and shared without a server.
 */
export type View =
  { page: 'overview' } | { page: 'vehicle'; deviceId: string } | { page: 'drivers' };

export function parseView(search: string): View {
  const params = new URLSearchParams(search);
  const deviceId = params.get('vehicle');
  if (deviceId) return { page: 'vehicle', deviceId };
  if (params.get('view') === 'drivers') return { page: 'drivers' };
  return { page: 'overview' };
}

export function viewSearch(view: View): string {
  if (view.page === 'vehicle') return `?vehicle=${encodeURIComponent(view.deviceId)}`;
  if (view.page === 'drivers') return '?view=drivers';
  return '';
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
