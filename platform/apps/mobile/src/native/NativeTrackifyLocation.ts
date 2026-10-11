// Codegen spec for the Android location module in
// android/app/src/main/java/com/ridexe/trackify/location. Changing a signature here changes the
// generated NativeTrackifyLocationSpec base class, so update TrackifyLocationModule.kt with it.
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type TrackingOptions = {
  /** How often the native service hands a window of fixes to JS; it samples every second. */
  intervalMs: number;
  accuracy: string;
  notificationTitle: string;
  notificationBody: string;
};

export type NativeLocation = {
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  speedAccuracy?: number;
  bearingAccuracy?: number;
  /** Monotonic milliseconds since boot, for ordering and time gaps. */
  elapsedMs?: number;
  /** From a mock provider ("fake GPS" app). */
  mock?: boolean;
  provider?: string;
  satellites?: number;
  timestamp: number;
};

/** What can stop tracking from working, read on demand. */
export type DeviceHealth = {
  /** Missing when Android does not report a battery level. */
  batteryPct?: number;
  charging: boolean;
  /** The phone's Location setting; tracking gets no fixes while it is off. */
  locationEnabled: boolean;
  /** "still", "vehicle", "foot" or "bicycle"; missing without the Physical activity permission. */
  activity?: string;
  /** How long the current activity has lasted, milliseconds. */
  activityForMs?: number;
  /** Android may stop the app in the background to save battery. */
  batteryOptimized?: boolean;
};

export interface Spec extends TurboModule {
  start(options: TrackingOptions): Promise<void>;
  stop(): Promise<void>;
  /** Changes how often windows are handed to JS, without restarting tracking. */
  setInterval(intervalMs: number): Promise<void>;
  isRunning(): Promise<boolean>;
  getCurrentPosition(accuracy: string): Promise<NativeLocation>;
  deviceHealth(): Promise<DeviceHealth>;
  /** True while Android may stop the app in the background to save battery. */
  isBatteryOptimized(): Promise<boolean>;
  /** Opens the screen where the driver excludes Trackify from battery optimisation. */
  openBatterySettings(): Promise<void>;
  /** Shows Android's "always run in the background?" question; false when already allowed. */
  requestBatteryExemption(): Promise<boolean>;
  /** The phone maker's name when it has its own auto-start screen (Xiaomi, Oppo, …), else null. */
  vendorPowerScreen(): Promise<string | null>;
  openVendorPowerScreen(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrackifyLocation');
