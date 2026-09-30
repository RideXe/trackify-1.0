/** Accepts "30.5" and "30,5"; undefined for blank or anything that is not a number. */
export function parseDecimal(value: string): number | undefined {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return undefined;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}
