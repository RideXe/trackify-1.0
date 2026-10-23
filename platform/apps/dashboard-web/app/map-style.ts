// OpenFreeMap "Bright": OpenStreetMap-based tiles with no API key, account, or usage billing.
// Other free styles: liberty, positron, dark, fiord (https://openfreemap.org/quick_start/).
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';

/** maplibre-gl needs the browser (WebGL and workers), so it is loaded only on the client. */
export async function loadMapLibre() {
  const maplibre = await import('maplibre-gl');
  // The worker files are copied into public/ by scripts/copy-maplibre-worker.mjs.
  maplibre.setWorkerUrl(`/maplibre/${maplibre.getVersion()}/maplibre-gl-worker.js`);
  return maplibre;
}
