import { describe, expect, it } from 'vitest';
import { Gl200Decoder, type ProtocolPacket } from '../src/index';

// Reports come from the legacy server's Queclink text decoder tests.
const positions = (packets: ProtocolPacket[]) =>
  packets.flatMap((packet) => (packet.kind === 'positions' ? packet.positions : []));
const decode = (sentence: string) => new Gl200Decoder().push(Buffer.from(sentence, 'ascii'));

describe('Queclink', () => {
  it('finds the fix in reports of different models', () => {
    const reports: Array<[string, number, number, number]> = [
      [
        '+RESP:GTFRI,DF0200,868487004353181,cv100,14051,10,1,0,0.0,0,264.1,114.015515,22.537178,20210608064328,0460,0001,25F8,061A7D02,,0.0,,,,100,21,,,,20210608144354,32DB$',
        22.537178,
        114.015515,
        Date.UTC(2021, 5, 8, 6, 43, 28),
      ],
      [
        '+RESP:GTFRI,5E0100,861971050039361,,,,10,1,1,10.4,140,196.9,-80.709946,35.016525,20220302220944,0310,0260,1CE9,52A1,00,0.0,,,,,420000,,,,20220302220948,1B0B$',
        35.016525,
        -80.709946,
        Date.UTC(2022, 2, 2, 22, 9, 44),
      ],
      [
        '+RESP:GTSTT,110100,358688000000158,,41,0,4.3,92,70.0,121.354335,31.222073,20110214013254,0460,0000,18d8,6141,,20110214093254,0022$',
        31.222073,
        121.354335,
        Date.UTC(2011, 1, 14, 1, 32, 54),
      ],
    ];
    for (const [report, latitude, longitude, fixTime] of reports) {
      const [position] = positions(decode(report));
      expect(position).toMatchObject({ latitude, longitude, fixTime, valid: true });
    }
  });

  it('reads speed, course and altitude before the coordinates', () => {
    const [position] = positions(
      decode(
        '+RESP:GTFRI,5E0100,861971050039361,,,,10,1,1,10.4,140,196.9,-80.709946,35.016525,20220302220944,0310,0260,1CE9,52A1,00,0.0,,,,,420000,,,,20220302220948,1B0B$',
      ),
    );
    expect(position).toMatchObject({
      speedKmh: 10.4,
      courseDeg: 140,
      altitudeM: 196.9,
      attributes: { hdop: 1, type: 'FRI' },
    });
  });

  it('returns every fix of a multi-point report', () => {
    const report =
      '+RESP:GTFRI,1A0900,860599000306845,G3-313,0,0,3,1,2.1,0,426.7,8.611466,47.681639,20181214134603,0228,0001,077F,4812,25.2,1,5.7,34,437.3,8.611600,47.681846,20181214134619,0228,0001,077F,4812,25.2,1,4.4,62,438.2,8.611893,47.681983,20181214134635,0228,0001,077F,4812,25.2,84,20181214134700,0B21$';
    const fixes = positions(decode(report));
    expect(fixes.map((fix) => fix.fixTime)).toEqual([
      Date.UTC(2018, 11, 14, 13, 46, 3),
      Date.UTC(2018, 11, 14, 13, 46, 19),
      Date.UTC(2018, 11, 14, 13, 46, 35),
    ]);
    expect(new Set(fixes.map((fix) => fix.messageId)).size).toBe(3);
  });

  it('maps report types to alarms and ignition', () => {
    expect(
      positions(
        decode(
          '+RESP:GTSOS,DF0200,868487004358800,cv100,,00,1,1,0.0,0,138.0,114.015465,22.537372,20210714115224,0460,0001,25F8,061A7D02,,,20210714195224,20210714195224,03A6$',
        ),
      )[0]?.alarms,
    ).toEqual(['sos']);
    expect(
      positions(
        decode(
          '+RESP:GTVGN,C2010D,869653060009939,GV600M,453966,0,0.0,0,163.9,10.239379,45.931389,20231210233723,0222,0010,2F31,006D7621,,,0.0,20240107182623,143F$',
        ),
      )[0]?.attributes.ignition,
    ).toBe(true);
    const ignitionOff = decode(
      '+RESP:GTIGF,500101,868570000393782,,0,0,,,,,,,0730,0002,A08F,872B36,00,,0.0,20240921021804,E3B1$',
    );
    expect(positions(ignitionOff)).toEqual([]);
    expect(ignitionOff.at(-1)).toMatchObject({
      kind: 'status',
      status: { attributes: { ignition: false } },
    });
  });

  it('answers heartbeats and buffers split reports', () => {
    const decoder = new Gl200Decoder();
    const heartbeat = '+ACK:GTHBD,060100,135790246811220,,20100214093254,11F0$';
    expect(decoder.push(Buffer.from(heartbeat.slice(0, 20)))).toEqual([]);
    const packets = decoder.push(Buffer.from(heartbeat.slice(20)));
    expect(packets.at(-1)?.acknowledgement?.toString()).toBe('+SACK:GTHBD,060100,11F0$');
  });

  it('encodes the output command with the device password', () => {
    const decoder = new Gl200Decoder();
    expect(
      decoder.encodeCommand({ type: 'engineStop', payload: { password: 'gv300' } })?.toString(),
    ).toBe('AT+GTOUT=gv300,1,,,0,0,0,0,0,0,0,,,,,,,FFFF$');
    expect(decoder.encodeCommand({ type: 'engineResume', payload: {} })?.toString()).toBe(
      'AT+GTOUT=,0,,,0,0,0,0,0,0,0,,,,,,,FFFF$',
    );
  });
});
