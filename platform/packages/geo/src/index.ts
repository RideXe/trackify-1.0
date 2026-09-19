export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export type GeofenceShape =
  { type: 'circle'; center: GeoPoint; radiusM: number } | { type: 'polygon'; points: GeoPoint[] };

const EARTH_RADIUS_M = 6_371_008.8;

export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const lat1 = radians(from.latitude);
  const lat2 = radians(to.latitude);
  const deltaLat = radians(to.latitude - from.latitude);
  const deltaLon = radians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function contains(shape: GeofenceShape, point: GeoPoint): boolean {
  if (shape.type === 'circle') return distanceMeters(shape.center, point) <= shape.radiusM;
  if (shape.points.length < 3) return false;
  let inside = false;
  for (
    let index = 0, previous = shape.points.length - 1;
    index < shape.points.length;
    previous = index++
  ) {
    const currentPoint = shape.points[index];
    const previousPoint = shape.points[previous];
    if (!currentPoint || !previousPoint) continue;
    const crosses =
      currentPoint.latitude > point.latitude !== previousPoint.latitude > point.latitude &&
      point.longitude <
        ((previousPoint.longitude - currentPoint.longitude) *
          (point.latitude - currentPoint.latitude)) /
          (previousPoint.latitude - currentPoint.latitude) +
          currentPoint.longitude;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function plausibleDistance(
  from: GeoPoint & { fixTime: number },
  to: GeoPoint & { fixTime: number },
  maxSpeedKmh = 300,
): number {
  const elapsedSeconds = (to.fixTime - from.fixTime) / 1000;
  if (elapsedSeconds <= 0) return 0;
  const distance = distanceMeters(from, to);
  return distance / elapsedSeconds <= maxSpeedKmh / 3.6 ? distance : 0;
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}
