'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { Box } from '@mui/material';
import type { MapLibreMap, Marker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { MAP_STYLE, loadMapLibre } from './map-style';

/** The selected vehicle's position. The pin follows live updates and vehicle changes. */
export function VehicleMap({
  latitude,
  longitude,
  title,
}: {
  latitude: number;
  longitude: number;
  title: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | undefined>(undefined);
  const pin = useRef<Marker | undefined>(undefined);
  const position = useRef<[number, number]>([longitude, latitude]);
  position.current = [longitude, latitude];

  useEffect(() => {
    let disposed = false;
    void loadMapLibre().then((maplibre) => {
      const element = container.current;
      if (disposed || !element) return;
      const instance = new maplibre.MapLibreMap({
        container: element,
        style: MAP_STYLE,
        center: position.current,
        zoom: 15,
        attributionControl: { compact: true },
      });
      instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      pin.current = new maplibre.Marker({ color: '#079455' })
        .setLngLat(position.current)
        .addTo(instance);
      map.current = instance;
    });
    return () => {
      disposed = true;
      pin.current = undefined;
      map.current?.remove();
      map.current = undefined;
    };
  }, []);

  useEffect(() => {
    pin.current?.setLngLat([longitude, latitude]);
    map.current?.easeTo({ center: [longitude, latitude] });
  }, [latitude, longitude]);

  return (
    <Box
      ref={container}
      role="img"
      aria-label={title}
      sx={{ width: '100%', height: { xs: 360, md: 500 }, display: 'block', bgcolor: '#EEF2F6' }}
    />
  );
}
