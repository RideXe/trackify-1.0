// Codegen spec for the Android location module in
// android/app/src/main/java/com/ridexe/trackify/location. Changing a signature here changes the
// generated NativeTrackifyLocationSpec base class, so update TrackifyLocationModule.kt with it.
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type TrackingOptions = {
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
  timestamp: number;
};

export interface Spec extends TurboModule {
  start(options: TrackingOptions): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
  getCurrentPosition(accuracy: string): Promise<NativeLocation>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrackifyLocation');
