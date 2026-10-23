import { describe, expect, it } from 'vitest';
import { SuntechDecoder, type ProtocolPacket } from '../src/index';

// Reports and expected values come from the legacy server's Suntech decoder and encoder tests.
const positions = (packets: ProtocolPacket[]) =>
  packets.flatMap((packet) => (packet.kind === 'positions' ? packet.positions : []));
const decode = (line: string) => new SuntechDecoder().push(Buffer.from(`${line}\r`));

describe('Suntech', () => {
  it('decodes SA200 reports with the legacy expected values', () => {
    const [position] = positions(
      decode(
        'SA200STT;317652;042;20120718;15:37:12;16d41;-15.618755;-056.083241;000.024;000.00;8;1;41548;12.17;100000;2;1979',
      ),
    );
    expect(position).toMatchObject({
      fixTime: Date.UTC(2012, 6, 18, 15, 37, 12),
      valid: true,
      latitude: -15.618755,
      longitude: -56.083241,
    });
    expect(position?.attributes).toMatchObject({ ignition: true, satellites: 8, powerV: 12.17 });
  });

  it('decodes ST300 and ST600 reports with their extra fields', () => {
    const st300 = positions(
      decode(
        'ST300STT;007238270;40;313;20190220;12:05:04;c99e48;+04.644623;-074.076922;010.390;202.77;20;1;997100;14.10;100000;2;8384;003634;4.1;1',
      ),
    )[0];
    expect(st300).toMatchObject({
      latitude: 4.644623,
      longitude: -74.076922,
      speedKmh: 10.39,
      courseDeg: 202.77,
    });
    const st600 = positions(
      decode(
        'ST600STT;008084783;20;419;20180308;18:00:36;0032cc3e;736;3;445c;41;-16.530023;-068.084267;018.640;267.99;10;1;11655;13.33;100000;2;0336;000061;4.5;0;0.00',
      ),
    )[0];
    expect(st600).toMatchObject({
      latitude: -16.530023,
      longitude: -68.084267,
      fixTime: Date.UTC(2018, 2, 8, 18, 0, 36),
    });
  });

  it('maps emergencies and alerts to alarms', () => {
    expect(
      positions(
        decode(
          'SA200EMG;317652;042;20120718;15:35:41;16d41;-15.618740;-056.083252;000.034;000.00;8;1;41548;12.17;110000;1',
        ),
      )[0]?.alarms,
    ).toEqual(['sos']);
    expect(
      positions(
        decode(
          'ST300ALT;007239104;40;313;20190112;01:07:16;c99139;+04.703287;-074.148897;000.000;189.72;21;1;425512;12.61;100000;33;003188;4.1;1',
        ),
      )[0]?.alarms,
    ).toBeUndefined();
    expect(
      positions(
        decode(
          'SA200ALT;317652;042;20120829;14:25:58;16d41;-15.618770;-056.083242;000.029;000.00;0;0;2404240;0.00;000000;41',
        ),
      )[0]?.alarms,
    ).toEqual(['powerCut']);
  });

  it('reads command results and ignores keep-alives', () => {
    expect(decode('SA200CMD;Res;317652;02;Enable1;Ok').at(-1)).toMatchObject({
      kind: 'commandResult',
    });
    expect(positions(decode('SA200ALV;317652'))).toEqual([]);
  });

  it('encodes commands with the model prefix the tracker reports with', () => {
    const decoder = new SuntechDecoder();
    decoder.push(
      Buffer.from(
        'ST300STT;123456789012345;40;313;20190220;12:05:04;c99e48;+04.644623;-074.076922;010.390;202.77;20;1;997100;14.10;100000;2;8384\r',
      ),
    );
    expect(decoder.encodeCommand({ type: 'engineStop', payload: {} })?.toString()).toBe(
      'ST300CMD;123456789012345;02;Enable1\r',
    );
    expect(decoder.encodeCommand({ type: 'custom', payload: { data: 'Reboot' } })?.toString()).toBe(
      'ST300CMD;123456789012345;02;Reboot\r',
    );
  });
});
