import { addTrackerLog } from './storage';

type Handler = (error: unknown, isFatal?: boolean) => void;
const errorUtils = (
  globalThis as { ErrorUtils?: { getGlobalHandler(): Handler; setGlobalHandler(h: Handler): void } }
).ErrorUtils;

/**
 * Writes unexpected JavaScript errors to the tracker log (and the system log, tag TrackifyLog)
 * before React Native handles them as usual, so a crash on a driver's phone leaves a trace.
 */
export function recordErrors() {
  if (!errorUtils) return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    void addTrackerLog(`${isFatal ? 'Crash' : 'Error'}: ${message}`).catch(() => undefined);
    previous(error, isFatal);
  });
}
