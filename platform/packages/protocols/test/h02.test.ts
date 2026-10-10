import { describe, expect, it } from 'vitest';
import { H02Decoder, type DecodedPosition, type ProtocolPacket } from '../src/index';

// Frames and expected values come from the legacy server's H02 decoder and encoder tests.
const NOW = Date.parse('2026-10-12T04:30:00Z');
const text = (sentence: string) => Buffer.from(sentence, 'ascii');
const hex = (value: string) => Buffer.from(value, 'hex');
const positions = (packets: ProtocolPacket[]) =>
  packets.flatMap((packet) => (packet.kind === 'positions' ? packet.positions : []));
const decode = (frame: Buffer) => new H02Decoder(() => NOW).push(frame);

function expectPosition(
  position: DecodedPosition | undefined,
  time: string,
  valid: boolean,
  latitude: number,
  longitude: number,
) {
  expect(position?.fixTime).toBe(Date.parse(`${time}Z`));
  expect(position?.valid).toBe(valid);
  // The legacy tests state coordinates to five decimals.
  expect(position?.latitude).toBeCloseTo(latitude, 4);
  expect(position?.longitude).toBeCloseTo(longitude, 4);
}

describe('H02 text', () => {
  it('decodes positions in every coordinate format the legacy tests assert', () => {
    expectPosition(
      positions(
        decode(
          text(
            '*HQ,9001000002,V8,213945,A,3542.2043,N,38.6508,W,0.00,170,221025,FBFFF9FF,0,0,0,0,22,31,126,0#',
          ),
        ),
      )[0],
      '2025-10-22T21:39:45',
      true,
      35.7034,
      -0.64418,
    );
    expectPosition(
      positions(
        decode(
          text(
            '*HQ,4210051415,V1,164549,A,0956.3869,N,08406.7068,W,000.00,000,221215,FFFFFBFF,712,01,0,0,6#',
          ),
        ),
      )[0],
      '2015-12-22T16:45:49',
      true,
      9.93978,
      -84.11178,
    );
    expectPosition(
      positions(
        decode(
          text('*HQ,355488020119695,V1,050418,,2827.61232,N,07703.84822,E,0.00,0,031015,FFFEFBFF#'),
        ),
      )[0],
      '2015-10-03T05:04:18',
      false,
      28.46021,
      77.06414,
    );
    expectPosition(
      positions(
        decode(
          text('*HQ,1451316409,V1,030149,A,-23-29.0095,S,-46-51.5852,W,2.4,065,070315,FFFFFFFF#'),
        ),
      )[0],
      '2015-03-07T03:01:49',
      true,
      -23.48349,
      -46.85975,
    );
    const noDot = positions(
      decode(
        text(
          '*HQ,5905101893,V1,105759,A,37573392,S,145037022,E,000.00,173,280122,FF7FFBFF,,,9059e2c,8232,4#',
        ),
      ),
    )[0];
    expect(noDot?.latitude).toBeCloseTo(-(37 + 57.3392 / 60), 5);
    expect(noDot?.longitude).toBeCloseTo(145 + 3.7022 / 60, 5);
  });

  it('handles the optional battery field, SIM details before status, and spaces in speed', () => {
    const battery = positions(
      decode(
        text(
          '*HQ,4210209006,V1,054048,A,2828.2297,N,07733.4332,E,000.5,047,4,080918,EEE7FBDF,4261193,0#',
        ),
      ),
    )[0];
    expect(battery?.fixTime).toBe(Date.UTC(2018, 8, 8, 5, 40, 48));
    const sim = positions(
      decode(
        text(
          '*HQ,4209951296,V19,214452,A,5201.0178,N,01830.5029,E,000.00,000,200417,,195.63.13.195,89480610500392633029,BFFFFBFF#',
        ),
      ),
    )[0];
    expect(sim?.attributes.status).toBe(0xbffffbff);
    const spaced = positions(
      decode(
        text(
          '*HQ,865205035331981,V1,132926,A,1935.3933,N,07920.4134,E,  3.34,342,280519,FFFFFFFF#',
        ),
      ),
    )[0];
    expect(spaced?.speedKmh).toBeCloseTo(3.34 * 1.852, 1);
  });

  it('identifies the device once and answers V1 positions', () => {
    const decoder = new H02Decoder(() => NOW);
    const first = decoder.push(
      text('*HQ,4210051415,V1,164549,A,0956.3869,N,08406.7068,W,000.00,000,221215,FFFFFBFF#'),
    );
    expect(first.map((packet) => packet.kind)).toEqual(['identity', 'positions']);
    expect(first[0]).toMatchObject({ uniqueId: '4210051415' });
    expect(first[1]?.acknowledgement?.toString()).toBe('*HQ,4210051415,V4,V1,20261012043000#');
    const again = decoder.push(
      text('*HQ,4210051415,V1,164550,A,0956.3869,N,08406.7068,W,000.00,000,221215,FFFFFBFF#'),
    );
    expect(again.map((packet) => packet.kind)).toEqual(['positions']);
  });

  it('reads the status word: ignition and active-low alarms', () => {
    // EFE7F9FF: bit 19 (external power) and bit 10 (ignition) cleared.
    const powerCut = positions(
      decode(
        text(
          '*HQ,4210209006,V1,201812,A,2608.9437,N,08016.2521,W,000.80,000,150317,EFE7F9FF,310,260,0,0,6#',
        ),
      ),
    )[0];
    expect(powerCut?.alarms).toEqual(['powerCut']);
    expect(powerCut?.attributes.ignition).toBe(false);
    const quiet = positions(
      decode(
        text('*HQ,4210051415,V1,164549,A,0956.3869,N,08406.7068,W,000.00,000,221215,FFFFFFFF#'),
      ),
    )[0];
    expect(quiet?.alarms).toBeUndefined();
    expect(quiet?.attributes.ignition).toBe(true);
  });

  it('skips fixes without coordinates', () => {
    expect(
      positions(decode(text('*HQ,353505510948929,V1,,V,,N,,E,0.00,0,,FFFFF7FF,f0,a,11a0,c0c6#'))),
    ).toEqual([]);
    expect(
      positions(
        decode(
          text(
            '*HQ,353588020068342,V1,000000,V,0.0000,0,0.0000,0,0.00,0.00,000000,ffffffff,000106,000002,000203,004c87,16#',
          ),
        ),
      ),
    ).toEqual([]);
  });

  it('echoes heartbeats and reads battery', () => {
    const [, heartbeat] = decode(text('*HQ,135790246811220,HTBT,100#'));
    expect(heartbeat).toMatchObject({
      kind: 'status',
      status: { attributes: { batteryLevel: 100 } },
    });
    expect(heartbeat?.acknowledgement?.toString()).toBe('*HQ,135790246811220,HTBT#');
  });

  it('reads command replies together with their position', () => {
    const packets = decode(
      text(
        '*TH,2020916012,V4,S20,DONE,130305,050316,A,2212.8745,N,11346.6574,E,14.28,028,220902,F7FFFBFF#',
      ),
    );
    expect(packets.find((packet) => packet.kind === 'commandResult')).toEqual({
      kind: 'commandResult',
      result: 'S20,DONE,130305',
    });
    expect(positions(packets)[0]?.fixTime).toBe(Date.UTC(2002, 8, 22, 5, 3, 16));
  });

  it('buffers split frames and skips noise and line breaks', () => {
    const decoder = new H02Decoder(() => NOW);
    const frame =
      '*TH,2020916012,V1,050316,A,2212.8745,N,11346.6574,E,14.28,028,220902,FFFFFBFF#\r\n';
    expect(decoder.push(text(`xx${frame.slice(0, 20)}`))).toEqual([]);
    expect(positions(decoder.push(text(frame.slice(20))))).toHaveLength(1);
  });
});

describe('H02 binary', () => {
  it('decodes BCD frames with the legacy expected values', () => {
    const [, packet] = decode(
      hex(
        '24410600082621532131081504419390060740418306000000fffffbfdff0015060000002c02dc0c000000001f',
      ),
    );
    expect(packet).toMatchObject({ kind: 'positions' });
    expectPosition(positions([packet!])[0], '2015-08-31T21:53:21', true, 4.69898, -74.06971);
  });

  it('decodes short frames and reads the id', () => {
    const packets = decode(hex('2441060116601245431311165035313006004318210e000000fffffbffff0024'));
    expect(packets[0]).toMatchObject({ kind: 'identity', uniqueId: '4106011660' });
    const position = positions(packets)[0];
    expect(position?.fixTime).toBe(Date.UTC(2016, 10, 13, 12, 45, 43));
    expect(position?.latitude).toBeCloseTo(50 + 35.313 / 60, 4);
  });
});

describe('H02 commands', () => {
  it('encodes engine stop and resume like the legacy server', () => {
    const decoder = new H02Decoder(() => Date.parse('2026-10-12T01:02:03Z'));
    expect(decoder.encodeCommand({ type: 'engineStop', payload: {} })).toBeUndefined();
    decoder.push(
      text(
        '*HQ,123456789012345,V1,155850,A,5214.5346,N,2117.4683,E,0.00,270.90,131012,ffffffff,000000,000000,000000,000000#',
      ),
    );
    expect(decoder.encodeCommand({ type: 'engineStop', payload: {} })?.toString()).toBe(
      '*HQ,123456789012345,S20,010203,1,1#',
    );
    expect(decoder.encodeCommand({ type: 'engineResume', payload: {} })?.toString()).toBe(
      '*HQ,123456789012345,S20,010203,1,0#',
    );
  });
});
