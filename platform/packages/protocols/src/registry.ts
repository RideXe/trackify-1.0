import type { ProtocolDecoder } from './common';
import { Gl200Decoder } from './gl200';
import { Gps103Decoder } from './gps103';
import { Gt06Decoder } from './gt06';
import { H02Decoder } from './h02';
import { MeitrackDecoder } from './meitrack';
import type { TrackerProtocol } from './ports';
import { RuptelaDecoder } from './ruptela';
import { SuntechDecoder } from './suntech';
import { TeltonikaDecoder } from './teltonika';
import { Tk103Decoder } from './tk103';
import { TopinDecoder } from './topin';
import { WatchDecoder } from './watch';

/** One decoder per connection: decoders keep framing state and the device id. */
export const createDecoder: Record<TrackerProtocol, () => ProtocolDecoder> = {
  gt06: () => new Gt06Decoder(),
  teltonika: () => new TeltonikaDecoder(),
  h02: () => new H02Decoder(),
  gps103: () => new Gps103Decoder(),
  watch: () => new WatchDecoder(),
  meitrack: () => new MeitrackDecoder(),
  gl200: () => new Gl200Decoder(),
  suntech: () => new SuntechDecoder(),
  tk103: () => new Tk103Decoder(),
  ruptela: () => new RuptelaDecoder(),
  topin: () => new TopinDecoder(),
};
