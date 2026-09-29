'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { Box } from '@mui/material';
import { vehicleTypes, type Device, type VehicleType } from '@trackify/api-client';
import type { GeoJSONSource, MapLibreMap } from 'maplibre-gl';
import { LocateFixed, Scan } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  fleetBounds,
  fleetFeatures,
  hoverRows,
  statusColors,
  type VehicleProperties,
} from './fleet-map-data';
import {
  ButtonControl,
  CLUSTER_LAYER,
  FLEET_SOURCE,
  VEHICLE_LAYER,
  installFleetLayers,
  setFleetData,
  setFocus,
} from './fleet-map-layers';
import { MAP_STYLE, loadMapLibre } from './map-style';
import { vehicleIcons } from './vehicle-icons';

const INDIA: [number, number] = [78.9629, 22.5937];
/** "Show all vehicles" never zooms closer than street level, even for one vehicle. */
const FIT = { padding: 64, maxZoom: 15 };
const FOCUS_ZOOM = 15;

/**
 * Every vehicle on one map: clustered when zoomed out, round type pins coloured by status, a
 * direction arrow while moving, and a hover card. Clicking a pin selects that vehicle.
 */
export function FleetMap({
  devices,
  selectedId,
  onSelect,
}: {
  devices: Device[];
  selectedId?: string;
  onSelect: (deviceId: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const iconStore = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | undefined>(undefined);
  const latest = useRef({ devices, selectedId, onSelect });
  latest.current = { devices, selectedId, onSelect };
  const fitted = useRef(false);
  const shownSelection = useRef(selectedId);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | undefined;
    void loadMapLibre().then((maplibre) => {
      const element = container.current;
      if (disposed || !element) return;
      const instance = new maplibre.MapLibreMap({
        container: element,
        style: MAP_STYLE,
        center: INDIA,
        zoom: 4,
        // Country level at most, so nobody ends up lost looking at the whole world.
        minZoom: 3,
        maxZoom: 18,
        attributionControl: { compact: true },
      });
      map = instance;
      mapRef.current = instance;

      const vehicles = () => fleetFeatures(latest.current.devices).features;
      const findVehicle = (deviceId: unknown) =>
        vehicles().find((vehicle) => vehicle.properties.deviceId === deviceId);
      const svgOf = (name: string) =>
        iconStore.current?.querySelector(`[data-icon="${name}"]`)?.outerHTML ?? '';
      const showAll = () => {
        const bounds = fleetBounds(vehicles());
        if (bounds) instance.fitBounds(bounds, FIT);
      };
      const focusSelected = () => {
        const vehicle = vehicles().find((f) => f.properties.deviceId === latest.current.selectedId);
        if (!vehicle) return showAll();
        instance.easeTo({
          center: vehicle.geometry.coordinates,
          zoom: Math.max(instance.getZoom(), FOCUS_ZOOM),
        });
      };
      instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      instance.addControl(
        new ButtonControl([
          { label: 'Show all vehicles', svg: svgOf('show-all'), onClick: showAll },
          { label: 'Focus selected vehicle', svg: svgOf('focus'), onClick: focusSelected },
        ]),
        'top-right',
      );

      const popup = new maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 22 });
      instance.on('mousemove', VEHICLE_LAYER, (event) => {
        const vehicle = findVehicle(event.features?.[0]?.properties.deviceId);
        if (!vehicle) return;
        instance.getCanvas().style.cursor = 'pointer';
        popup
          .setLngLat(vehicle.geometry.coordinates)
          .setDOMContent(hoverCard(vehicle.properties))
          .addTo(instance);
      });
      instance.on('mouseleave', VEHICLE_LAYER, () => {
        instance.getCanvas().style.cursor = '';
        popup.remove();
      });
      instance.on('click', VEHICLE_LAYER, (event) => {
        const deviceId: unknown = event.features?.[0]?.properties.deviceId;
        if (typeof deviceId === 'string') latest.current.onSelect(deviceId);
      });
      instance.on('mouseenter', CLUSTER_LAYER, () => {
        instance.getCanvas().style.cursor = 'pointer';
      });
      instance.on('mouseleave', CLUSTER_LAYER, () => {
        instance.getCanvas().style.cursor = '';
      });
      instance.on('click', CLUSTER_LAYER, (event) => {
        const clusterId: unknown = event.features?.[0]?.properties.cluster_id;
        if (typeof clusterId !== 'number') return;
        // Zoom in where the cluster was clicked, far enough for it to split apart.
        void instance
          .getSource<GeoJSONSource>(FLEET_SOURCE)
          ?.getClusterExpansionZoom(clusterId)
          .then((zoom) => instance.easeTo({ center: event.lngLat, zoom }));
      });

      instance.on('load', () => {
        const whiteIcons = Object.fromEntries(
          vehicleTypes.map((type) => [type, svgOf(type)]),
        ) as Record<VehicleType, string>;
        void installFleetLayers(instance, whiteIcons).then(() => {
          if (!disposed) setReady(true);
        });
      });
    });
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = undefined;
    };
  }, []);

  // Live data: redraw pins without moving the camera; fit the whole fleet once on first load.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const collection = fleetFeatures(devices);
    setFleetData(map, collection);
    const selected = collection.features.find((f) => f.properties.deviceId === selectedId);
    setFocus(map, selected?.geometry.coordinates);
    if (!fitted.current && collection.features.length) {
      fitted.current = true;
      const bounds = fleetBounds(collection.features);
      if (bounds) map.fitBounds(bounds, { ...FIT, duration: 0 });
    }
  }, [devices, selectedId, ready]);

  // Choosing a vehicle (in the list or on the map) brings it into view.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || selectedId === shownSelection.current) return;
    shownSelection.current = selectedId;
    const vehicle = fleetFeatures(latest.current.devices).features.find(
      (f) => f.properties.deviceId === selectedId,
    );
    if (vehicle)
      map.easeTo({
        center: vehicle.geometry.coordinates,
        zoom: Math.max(map.getZoom(), FOCUS_ZOOM),
      });
  }, [selectedId, ready]);

  return (
    <>
      <Box
        ref={container}
        sx={{ width: '100%', height: { xs: 380, md: 520 }, display: 'block', bgcolor: '#EEF2F6' }}
      />
      {/* The same icons as the rest of the UI, rendered once and hidden, so the map can draw
          them into its pin images and buttons. */}
      <Box ref={iconStore} aria-hidden sx={{ display: 'none' }}>
        {vehicleTypes.map((type) => {
          const { Icon } = vehicleIcons[type];
          return <Icon key={type} data-icon={type} color="#FFFFFF" size={24} />;
        })}
        <Scan data-icon="show-all" color="#344054" size={20} />
        <LocateFixed data-icon="focus" color="#344054" size={20} />
      </Box>
    </>
  );
}

/** Built from text nodes: vehicle names are user input and must never be parsed as HTML. */
function hoverCard(vehicle: VehicleProperties) {
  const card = document.createElement('div');
  card.style.cssText = 'font: 13px/1.45 system-ui, sans-serif; color: #101828; min-width: 190px';
  const title = document.createElement('div');
  title.style.cssText = 'display: flex; align-items: center; gap: 6px; font-weight: 700';
  const dot = document.createElement('span');
  dot.style.cssText = `width: 9px; height: 9px; border-radius: 50%; background: ${statusColors[vehicle.status]}`;
  title.append(dot, `${vehicle.name}`);
  const type = document.createElement('div');
  type.style.cssText = 'color: #667085; font-size: 12px; margin-bottom: 6px';
  type.textContent = vehicleIcons[vehicle.vehicleType]?.label ?? '';
  card.append(title, type);
  for (const [label, value] of hoverRows(vehicle)) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; justify-content: space-between; gap: 16px';
    const name = document.createElement('span');
    name.style.color = '#667085';
    name.textContent = label;
    const text = document.createElement('span');
    text.style.fontWeight = '600';
    text.textContent = value;
    row.append(name, text);
    card.append(row);
  }
  return card;
}
