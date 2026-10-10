import { GeoPlacesClient, ReverseGeocodeCommand } from '@aws-sdk/client-geo-places';

/**
 * `display` addresses are shown once (an alert); `storage` ones are saved (trip start and end).
 * Amazon Location prices and licenses the two differently, so callers must say which they need.
 */
export type AddressUse = 'display' | 'storage';

export interface Geocoder {
  /** A one-line address, or undefined when none is known or the lookup failed or timed out. */
  address(latitude: number, longitude: number, use: AddressUse): Promise<string | undefined>;
}

/** Reverse geocoding off: everything shows coordinates instead. */
export const noGeocoder: Geocoder = { address: () => Promise.resolve(undefined) };

const CACHE_SIZE = 5_000;

/**
 * Amazon Location reverse geocoding with a small in-memory cache. Coordinates are rounded to about
 * 11 m, so a parked vehicle's repeated alerts cost one lookup. A lookup never throws and gives up
 * after `timeoutMs`, because an address must never delay tracking or an alert.
 */
export class AmazonLocationGeocoder implements Geocoder {
  private readonly cache = new Map<string, string | undefined>();

  constructor(
    private readonly client: Pick<GeoPlacesClient, 'send'>,
    private readonly options: { language?: string; timeoutMs?: number } = {},
  ) {}

  async address(latitude: number, longitude: number, use: AddressUse) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
    const key = `${use}:${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    if (this.cache.has(key)) {
      const value = this.cache.get(key);
      // Refresh recency: delete and re-insert keeps the Map in least-recently-used order.
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.options.timeoutMs ?? 1_500);
    try {
      const result = await this.client.send(
        new ReverseGeocodeCommand({
          QueryPosition: [longitude, latitude],
          MaxResults: 1,
          Language: this.options.language ?? 'en',
          IntendedUse: use === 'storage' ? 'Storage' : 'SingleUse',
        }),
        { abortSignal: abort.signal },
      );
      const label = result.ResultItems?.[0]?.Address?.Label ?? result.ResultItems?.[0]?.Title;
      this.remember(key, label);
      return label;
    } catch (error) {
      console.warn('reverse geocoding failed', {
        error: error instanceof Error ? error.name : error,
      });
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(key: string, value: string | undefined) {
    if (this.cache.size >= CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }
}

/** The geocoder for this environment: on only when GEOCODING=on was deployed. */
export function geocoderFromEnv(): Geocoder {
  return process.env.GEOCODING === 'on'
    ? new AmazonLocationGeocoder(new GeoPlacesClient({}))
    : noGeocoder;
}
