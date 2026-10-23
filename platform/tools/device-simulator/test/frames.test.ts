import { Gt06Decoder, TeltonikaDecoder } from '@trackify/protocols';
import { describe, expect, it } from 'vitest';
import {
  gt06LoginFrame,
  gt06PositionFrame,
  teltonikaLoginFrame,
  teltonikaPositionFrame,
} from '../src/frames';

const imei = '359632101234567';

describe('simulator frames', () => {
  it('builds GT06 frames accepted by the production decoder', () => {
    const decoder = new Gt06Decoder();
    expect(decoder.push(gt06LoginFrame(imei))[0]).toMatchObject({
      kind: 'identity',
      uniqueId: imei,
    });
    expect(decoder.push(gt06PositionFrame(12.9716, 77.5946))[0]).toMatchObject({
      kind: 'positions',
      positions: [{ latitude: 12.9716, longitude: 77.5946 }],
    });
  });

  it('builds Teltonika frames accepted by the production decoder', () => {
    const decoder = new TeltonikaDecoder();
    expect(decoder.push(teltonikaLoginFrame(imei))[0]).toMatchObject({
      kind: 'identity',
      uniqueId: imei,
    });
    expect(decoder.push(teltonikaPositionFrame(12.9716, 77.5946))[0]).toMatchObject({
      kind: 'positions',
      positions: [{ latitude: 12.9716, longitude: 77.5946 }],
    });
  });
});
