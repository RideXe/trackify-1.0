'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { Box } from '@mui/material';
import type { MapLibreMap, Marker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { MAP_STYLE, loadMapLibre } from './map-style';
import type { RoutePoint } from './route-data';

export function RouteMap({ points, current }: { points: RoutePoint[]; current?: RoutePoint }) {
  const container = useRef<HTMLDivElement>(null);
  const cursor = useRef<Marker | undefined>(undefined);
  const initial = useRef(current);
  initial.current = current;

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let disposed = false;
    void loadMapLibre().then((maplibre) => {
      const element = container.current;
      const first = points[0];
      const last = points.at(-1);
      if (disposed || !element || !first || !last) return;
      const bounds = new maplibre.LngLatBounds();
      for (const point of points) bounds.extend([point.longitude, point.latitude]);
      map = new maplibre.MapLibreMap({
        container: element,
        style: MAP_STYLE,
        bounds,
        fitBoundsOptions: { padding: 48, maxZoom: 16 },
        attributionControl: { compact: true },
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      const line = map;
      if (points.length > 1)
        line.on('load', () => {
          line.addSource('route', {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: points.map((point) => [point.longitude, point.latitude]),
              },
            },
          });
          line.addLayer({
            id: 'route',
            type: 'line',
            source: 'route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#155EEF', 'line-width': 4 },
          });
        });
      new maplibre.Marker({ color: '#079455' })
        .setLngLat([first.longitude, first.latitude])
        .addTo(map);
      if (last !== first)
        new maplibre.Marker({ color: '#D92D20' })
          .setLngLat([last.longitude, last.latitude])
          .addTo(map);
      const start = initial.current ?? first;
      cursor.current = new maplibre.Marker({ element: cursorElement() })
        .setLngLat([start.longitude, start.latitude])
        .addTo(map);
    });
    return () => {
      disposed = true;
      cursor.current = undefined;
      map?.remove();
    };
  }, [points]);

  useEffect(() => {
    if (current) cursor.current?.setLngLat([current.longitude, current.latitude]);
  }, [current]);

  return (
    <Box
      ref={container}
      sx={{ height: { xs: 360, md: 460 }, borderRadius: 2, overflow: 'hidden', bgcolor: '#EEF2F6' }}
    />
  );
}

function cursorElement() {
  const element = document.createElement('div');
  element.style.cssText =
    'width:18px;height:18px;border-radius:50%;background:#155EEF;border:3px solid #fff;' +
    'box-shadow:0 0 0 3px rgba(21,94,239,.35)';
  return element;
}
