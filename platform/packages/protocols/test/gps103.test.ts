import { describe, expect, it } from 'vitest';
import { Gps103Decoder, type ProtocolPacket } from '../src/index';

// Sentences and expected values come from the legacy server's GPS103 decoder tests.
const positions = (packets: ProtocolPacket[]) =>
  packets.flatMap((packet) => (packet.kind === 'positions' ? packet.positions : []));
const decode = (sentence: string) => new Gps103Decoder().push(Buffer.from(sentence));

describe('GPS103', () => {
  it('decodes positions with the legacy expected time and coordinates, including the zone shift', () => {
    const cases: Array<[string, string, number, number]> = [
      [
        'imei:359710045559474,tracker,151030080103,,F,000101.000,A,5443.3834,N,02512.9071,E,0.00,0;',
        '2015-10-30T00:01:01Z',
        54.72306,
        25.21512,
      ],
      [
        'imei:359710049092324,tracker,151027025958,,F,235957.000,A,2429.5156,N,04424.5828,E,0.01,27.91,,0,0,,,;',
        '2015-10-26T23:59:57Z',
        24.49193,
        44.40971,
      ],
      [
        'imei:865328021058861,tracker,151027041419,,F,011531.000,A,6020.2979,N,02506.1940,E,0.49,113.30,,0,0,0.0%,,;',
        '2015-10-27T01:15:31Z',
        60.3383,
        25.10323,
      ],
    ];
    for (const [sentence, time, latitude, longitude] of cases) {
      const [position] = positions(decode(sentence));
      expect(position?.fixTime).toBe(Date.parse(time));
      expect(position?.latitude).toBeCloseTo(latitude, 4);
      expect(position?.longitude).toBeCloseTo(longitude, 4);
    }
  });

  it('accepts slashed dates, hemispheres before coordinates and an empty longitude hemisphere', () => {
    expect(
      positions(
        decode(
          'imei:359710040656622,tracker,13/02/27 23:40,,F,125952.000,A,3450.9430,S,13828.6753,E,0.00,0;',
        ),
      )[0]?.latitude,
    ).toBeLessThan(0);
    const before = positions(
      decode(
        'imei:353552045403597,tracker,150420050648,53.0,F,0.0,A,N,5306.64155,E,00700.77848,0.0,,1.0,;',
      ),
    )[0];
    expect(before?.latitude).toBeCloseTo(53.11069, 4);
    expect(before?.longitude).toBeCloseTo(7.01297, 4);
    const missing = positions(
      decode(
        'imei:863070010423167,tracker,1211051840,,F,104000.000,A,2220.6483,N,11407.6377,,0,0,;',
      ),
    )[0];
    expect(missing?.longitude).toBeGreaterThan(0);
  });

  it('maps events to alarms, ignition and driver cards, and confirms SOS', () => {
    const sos = decode(
      'imei:359586015829802,help me,0809231429,13554900601,F,062947.294,A,2234.4026,N,11354.3277,E,0.00,;',
    );
    expect(positions(sos)[0]?.alarms).toEqual(['sos']);
    expect(sos.at(-1)?.acknowledgement?.toString()).toBe('**,imei:359586015829802,E;');
    expect(
      positions(
        decode(
          'imei:862106021237716,ac alarm,1611291645,,F,204457.000,A,1010.2783,N,06441.0274,W,0.00,,;',
        ),
      )[0]?.alarms,
    ).toEqual(['powerCut']);
    expect(
      positions(
        decode(
          'imei:864180036029895,acc on,180508145653,,F,065645.000,A,4729.1497,N,01904.2342,E,0.00,0,,1,,0.00%,,;',
        ),
      )[0]?.attributes.ignition,
    ).toBe(true);
    expect(
      positions(
        decode(
          'imei:868683020235846,rfid,160202091347,49121185,F,011344.000,A,0447.7273,N,07538.9934,W,0.00,0,,0,0,0.00%,,;',
        ),
      )[0]?.attributes.driverUniqueId,
    ).toBe('49121185');
  });

  it('reads ignition, door and fuel columns', () => {
    const [position] = positions(
      decode(
        'imei:353451044508750,001,0809231929,13554900601,F,055403.000,A,2233.1870,N,11354.3067,E,0.00,30.1,65.43,1,0,10.5%,0.0%,28;',
      ),
    );
    expect(position?.attributes).toMatchObject({
      ignition: true,
      door: false,
      fuel1: 10.5,
      temp1: 28,
    });
    expect(position?.altitudeM).toBe(65.43);
  });

  it('answers the login with LOAD and heartbeats with ON', () => {
    const decoder = new Gps103Decoder();
    const login = decoder.push(Buffer.from('##,imei:359586015829802,A;'));
    expect(login).toEqual([
      { kind: 'identity', uniqueId: '359586015829802', acknowledgement: Buffer.from('LOAD') },
    ]);
    expect(decoder.push(Buffer.from('359586015829802;'))[0]?.acknowledgement?.toString()).toBe(
      'ON',
    );
  });

  it('reports cell-only alarms without a position', () => {
    const packets = decode('imei:865456055519122,sensor alarm,2208011920,,L,;');
    expect(positions(packets)).toEqual([]);
    expect(packets.at(-1)).toMatchObject({ kind: 'status', status: { alarms: ['vibration'] } });
  });

  it('encodes engine commands like the legacy encoder', () => {
    const decoder = new Gps103Decoder();
    decoder.push(Buffer.from('##,imei:123456789012345,A;'));
    expect(decoder.encodeCommand({ type: 'engineStop', payload: {} })?.toString()).toBe(
      '**,imei:123456789012345,J',
    );
    expect(decoder.encodeCommand({ type: 'engineResume', payload: {} })?.toString()).toBe(
      '**,imei:123456789012345,K',
    );
  });
});
