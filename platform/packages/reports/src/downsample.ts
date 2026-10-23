export interface SeriesPoint {
  time: number;
  value: number;
}

/**
 * Largest-Triangle-Three-Buckets: keeps the visual shape of a series (peaks such as a speeding
 * spike survive) while returning at most `threshold` points for a chart.
 */
export function downsample(points: readonly SeriesPoint[], threshold: number): SeriesPoint[] {
  if (threshold >= points.length || threshold < 3) return [...points];
  const sampled: SeriesPoint[] = [points[0]!];
  const bucketSize = (points.length - 2) / (threshold - 2);
  let previous = 0;
  for (let bucket = 0; bucket < threshold - 2; bucket += 1) {
    const nextStart = Math.floor((bucket + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((bucket + 2) * bucketSize) + 1, points.length);
    let averageTime = 0;
    let averageValue = 0;
    for (let index = nextStart; index < nextEnd; index += 1) {
      averageTime += points[index]!.time;
      averageValue += points[index]!.value;
    }
    const count = Math.max(1, nextEnd - nextStart);
    averageTime /= count;
    averageValue /= count;
    const start = Math.floor(bucket * bucketSize) + 1;
    const end = Math.floor((bucket + 1) * bucketSize) + 1;
    const anchor = points[previous]!;
    let largest = -1;
    let chosen = start;
    for (let index = start; index < end; index += 1) {
      const point = points[index]!;
      const area = Math.abs(
        (anchor.time - averageTime) * (point.value - anchor.value) -
          (anchor.time - point.time) * (averageValue - anchor.value),
      );
      if (area > largest) {
        largest = area;
        chosen = index;
      }
    }
    sampled.push(points[chosen]!);
    previous = chosen;
  }
  sampled.push(points[points.length - 1]!);
  return sampled;
}
