// Map layers for the fleet map. Vehicles are drawn by the GPU from one clustered GeoJSON source,
// not one DOM marker each, so thousands of vehicles stay smooth.
import { vehicleTypes, type VehicleType } from '@trackify/api-client';
import type { GeoJSONSource, IControl, MapLibreMap } from 'maplibre-gl';
import {
  statusColors,
  vehicleIconId,
  type FleetCollection,
  type VehicleStatus,
} from './fleet-map-data';

export const FLEET_SOURCE = 'fleet';
export const VEHICLE_LAYER = 'fleet-vehicles';
export const CLUSTER_LAYER = 'fleet-clusters';
const FOCUS_SOURCE = 'fleet-focus';
const HEADING_IMAGE = 'fleet-heading';
const LABEL_FONT = ['Noto Sans Bold'];
const PIXEL_RATIO = 2;
const PIN = 44;

const empty = { type: 'FeatureCollection', features: [] } as const;

/** Round badge in the status colour with the vehicle icon in white. */
async function drawBadge(iconSvg: string, color: string) {
  const size = PIN * PIXEL_RATIO;
  const context = canvas(size);
  const centre = size / 2;
  context.shadowColor = 'rgba(16, 24, 40, 0.3)';
  context.shadowBlur = 6 * PIXEL_RATIO;
  context.shadowOffsetY = 2 * PIXEL_RATIO;
  context.beginPath();
  context.arc(centre, centre, 16 * PIXEL_RATIO, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.shadowColor = 'transparent';
  context.lineWidth = 3 * PIXEL_RATIO;
  context.strokeStyle = '#FFFFFF';
  context.stroke();
  const icon = await svgImage(iconSvg);
  const iconSize = 18 * PIXEL_RATIO;
  context.drawImage(icon, centre - iconSize / 2, centre - iconSize / 2, iconSize, iconSize);
  return context.getImageData(0, 0, size, size);
}

/** Arrow just outside the badge; the layer rotates it to the direction of travel. */
function drawHeadingArrow() {
  const size = 64 * PIXEL_RATIO;
  const context = canvas(size);
  const at = (value: number) => value * PIXEL_RATIO;
  context.beginPath();
  context.moveTo(at(32), at(3));
  context.lineTo(at(39), at(13));
  context.lineTo(at(25), at(13));
  context.closePath();
  context.fillStyle = statusColors.moving;
  context.strokeStyle = '#FFFFFF';
  context.lineWidth = at(2);
  context.lineJoin = 'round';
  context.stroke();
  context.fill();
  return context.getImageData(0, 0, size, size);
}

function canvas(size: number) {
  const element = document.createElement('canvas');
  element.width = size;
  element.height = size;
  const context = element.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  return context;
}

async function svgImage(svg: string) {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  return image;
}

/** Adds pin images, the clustered vehicle source and its layers. Call once the style has loaded. */
export async function installFleetLayers(
  map: MapLibreMap,
  whiteIconSvgs: Record<VehicleType, string>,
) {
  const statuses = Object.keys(statusColors) as VehicleStatus[];
  await Promise.all(
    vehicleTypes.flatMap((type) =>
      statuses.map(async (status) => {
        const image = await drawBadge(whiteIconSvgs[type], statusColors[status]);
        if (!map.hasImage(vehicleIconId(type, status)))
          map.addImage(vehicleIconId(type, status), image, { pixelRatio: PIXEL_RATIO });
      }),
    ),
  );
  if (!map.hasImage(HEADING_IMAGE))
    map.addImage(HEADING_IMAGE, drawHeadingArrow(), { pixelRatio: PIXEL_RATIO });

  map.addSource(FLEET_SOURCE, {
    type: 'geojson',
    data: empty,
    cluster: true,
    clusterRadius: 48,
    clusterMaxZoom: 13,
  });
  map.addSource(FOCUS_SOURCE, { type: 'geojson', data: empty });

  const isCluster = ['has', 'point_count'] as const;
  map.addLayer({
    id: CLUSTER_LAYER,
    type: 'circle',
    source: FLEET_SOURCE,
    filter: isCluster,
    paint: {
      'circle-color': '#155EEF',
      'circle-opacity': 0.92,
      'circle-radius': ['step', ['get', 'point_count'], 18, 10, 22, 50, 28],
      'circle-stroke-color': '#FFFFFF',
      'circle-stroke-width': 3,
    },
  });
  map.addLayer({
    id: 'fleet-cluster-count',
    type: 'symbol',
    source: FLEET_SOURCE,
    filter: isCluster,
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': LABEL_FONT,
      'text-size': 13,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#FFFFFF' },
  });
  map.addLayer({
    id: 'fleet-focus-ring',
    type: 'circle',
    source: FOCUS_SOURCE,
    paint: {
      'circle-radius': 30,
      'circle-color': '#155EEF',
      'circle-opacity': 0.12,
      'circle-stroke-color': '#155EEF',
      'circle-stroke-width': 2.5,
    },
  });
  map.addLayer({
    id: 'fleet-headings',
    type: 'symbol',
    source: FLEET_SOURCE,
    filter: ['all', ['!', isCluster], ['==', ['get', 'status'], 'moving']],
    layout: {
      'icon-image': HEADING_IMAGE,
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  map.addLayer({
    id: VEHICLE_LAYER,
    type: 'symbol',
    source: FLEET_SOURCE,
    filter: ['!', isCluster],
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-allow-overlap': true,
      'text-field': ['get', 'name'],
      'text-font': LABEL_FONT,
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 1.6],
      'text-max-width': 10,
      'text-optional': true,
    },
    paint: {
      'text-color': '#101828',
      'text-halo-color': '#FFFFFF',
      'text-halo-width': 1.6,
    },
  });
}

export function setFleetData(map: MapLibreMap, collection: FleetCollection) {
  map.getSource<GeoJSONSource>(FLEET_SOURCE)?.setData(collection);
}

/** Draws the ring around the focused vehicle, or clears it. */
export function setFocus(map: MapLibreMap, coordinates: [number, number] | undefined) {
  map
    .getSource<GeoJSONSource>(FOCUS_SOURCE)
    ?.setData(
      coordinates
        ? { type: 'Feature', geometry: { type: 'Point', coordinates }, properties: {} }
        : empty,
    );
}

/** Extra buttons in the same style as the zoom buttons. */
export class ButtonControl implements IControl {
  private container?: HTMLElement;

  constructor(private readonly buttons: Array<{ label: string; svg: string; onClick: () => void }>) {}

  onAdd() {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    for (const { label, svg, onClick } of this.buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.style.display = 'grid';
      button.style.placeItems = 'center';
      // Parsed as an SVG document rather than assigned as HTML.
      button.append(new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement);
      button.addEventListener('click', onClick);
      container.append(button);
    }
    this.container = container;
    return container;
  }

  onRemove() {
    this.container?.remove();
  }
}
