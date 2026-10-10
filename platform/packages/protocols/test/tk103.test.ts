import { describe, expect, it } from 'vitest';
import { Tk103Decoder, type ProtocolPacket } from '../src/index';

// Sentences and expected values come from the legacy server's TK103 decoder and encoder tests.
const positions = (packets: ProtocolPacket[]) =>
  packets.flatMap((packet) => (packet.kind === 'positions' ? packet.positions : []));
const decode = (sentence: string) => new Tk103Decoder().push(Buffer.from(sentence, 'ascii'));

describe('TK103', () => {
  it('decodes positions with the legacy expected values', () => {
    const [position] = positions(
      decode('(088047365460BR00151024A2555.3531S02855.3329E004.7055148276.1701000000L00009AA3)'),
    );
    expect(position).toMatchObject({
      fixTime: Date.UTC(2015, 9, 24, 5, 51, 48),
      valid: true,
      speedKmh: 4.7,
      courseDeg: 276.17,
    });
    expect(position?.latitude).toBeCloseTo(-25.92255, 4);
    expect(position?.longitude).toBeCloseTo(28.92222, 4);
    expect(position?.attributes).toMatchObject({ ignition: true, charge: true, odometer: 0x9aa3 });
  });

  it('reads spaced coordinates and a trailing temperature', () => {
    const spaced = positions(
      decode('(027023361470BR00200617A4000.5775N 8415.4076W 46.0173725 87.3101000000L00000000)'),
    )[0];
    expect(spaced?.longitude).toBeCloseTo(-(84 + 15.4076 / 60), 4);
    expect(spaced?.speedKmh).toBe(46);
    const warm = positions(
      decode(
        '(088046338039BR00160727A3354.7768N03540.7258E000.0140832068.4700000000L00BEB0D4+017.7)',
      ),
    )[0];
    expect(warm?.attributes.temp1).toBe(17.7);
  });

  it('answers the login and positions sent on request', () => {
    const decoder = new Tk103Decoder();
    expect(decoder.push(Buffer.from('(087073005534BP00HSO)'))).toEqual([
      {
        kind: 'identity',
        uniqueId: '087073005534',
        acknowledgement: Buffer.from('(087073005534AP01HSO)'),
      },
    ]);
    const onRequest = decoder.push(
      Buffer.from(
        '(087073005534BP05000087073005534150917A1352.9801N10030.9050E000.0103115265.5600010000L000003F9)',
      ),
    );
    expect(onRequest.at(-1)?.acknowledgement?.toString()).toBe('(087073005534AP05)');
    expect(positions(onRequest)[0]?.fixTime).toBe(Date.UTC(2015, 8, 17, 10, 31, 15));
  });

  it('maps alarm messages', () => {
    expect(
      positions(
        decode('(013612345678BO012061830A2934.0133N10627.2544E040.0080331309.6200000000L000770AD)'),
      )[0]?.alarms,
    ).toEqual(['sos']);
    expect(
      positions(
        decode(
          '(044027395704BQ81,ALARM,1,164,151101A2238.5237N11349.4571E0.7031241010.0000,00000000)',
        ),
      )[0]?.alarms,
    ).toEqual(['overspeed']);
  });

  it('skips empty fixes and splits back-to-back sentences', () => {
    expect(
      positions(
        decode('(087072009461BR00000007V0000.0000N00000.0000E000.00014039900000000L00000000)'),
      ),
    ).toEqual([]);
    const decoder = new Tk103Decoder();
    const both = decoder.push(
      Buffer.from(
        '(088048003342BR00150917A1352.9801N10030.9050E000.0103224000.0000010000L000003F9)(088048003342BR00150807A1352.9871N10030.9084E000.0110718000.0001010000L00000000)',
      ),
    );
    expect(positions(both)).toHaveLength(2);
  });

  it('encodes engine commands like the legacy encoder', () => {
    const decoder = new Tk103Decoder();
    decoder.push(Buffer.from('(123456789012BP00HSO)'));
    expect(decoder.encodeCommand({ type: 'engineStop', payload: {} })?.toString()).toBe(
      '(123456789012AV010)',
    );
    expect(decoder.encodeCommand({ type: 'engineResume', payload: {} })?.toString()).toBe(
      '(123456789012AV011)',
    );
  });
});
