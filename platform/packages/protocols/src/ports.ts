/**
 * Tracker protocols the gateway speaks, each on its own TCP port. Ports follow the legacy server's
 * defaults, so trackers configured for it need only the new host name. Kept free of decoder code
 * so infrastructure can read it.
 */
export const trackerProtocols = {
  gt06: { port: 5023, label: 'GT06 / Concox / JimiIoT' },
  teltonika: { port: 5027, label: 'Teltonika' },
  h02: { port: 5013, label: 'H02 (Sinotrack and compatibles)' },
  gps103: { port: 5001, label: 'GPS103 (Coban TK103B and compatibles)' },
  watch: { port: 5093, label: 'Watch (3G/4G GPS watches)' },
  meitrack: { port: 5020, label: 'Meitrack' },
  gl200: { port: 5004, label: 'Queclink GL/GV series' },
  suntech: { port: 5011, label: 'Suntech' },
  tk103: { port: 5002, label: 'TK103 (Xexun and compatibles)' },
  ruptela: { port: 5046, label: 'Ruptela' },
  topin: { port: 5199, label: 'Topin (ZX series)' },
} as const;

export type TrackerProtocol = keyof typeof trackerProtocols;

export function isTrackerProtocol(value: unknown): value is TrackerProtocol {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(trackerProtocols, value);
}
