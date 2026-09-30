import { describe, expect, it } from 'vitest';
import { parseView, viewSearch, type View } from './view-state';

describe('dashboard views in the address bar', () => {
  it('round-trips every view, including ids that need escaping', () => {
    const views: View[] = [
      { page: 'overview' },
      { page: 'drivers' },
      { page: 'alerts' },
      { page: 'settings' },
      { page: 'vehicle', deviceId: '01JABC/with space' },
    ];
    for (const view of views) expect(parseView(viewSearch(view))).toEqual(view);
  });

  it('falls back to the overview for anything it does not recognise', () => {
    expect(parseView('')).toEqual({ page: 'overview' });
    expect(parseView('?view=reports')).toEqual({ page: 'overview' });
    expect(parseView('?vehicle=')).toEqual({ page: 'overview' });
  });
});
