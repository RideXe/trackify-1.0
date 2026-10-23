import { describe, expect, it } from 'vitest';
import { MeitrackDecoder, type ProtocolPacket } from '../src/index';

// Frames and expected values come from the legacy server's Meitrack decoder and encoder tests.
const positions = (packets: ProtocolPacket[]) =>
  packets.flatMap((packet) => (packet.kind === 'positions' ? packet.positions : []));
/**
 * Frames arrive with CRLF, which the length field counts. The legacy tests skipped framing, so
 * some of their length fields are off; the real length is put back here.
 */
const framed = (sentence: string) => {
  const comma = sentence.indexOf(',');
  const rest = `${sentence.slice(comma)}\r\n`;
  return Buffer.from(`${sentence.slice(0, 3)}${rest.length}${rest}`, 'ascii');
};
const decode = (sentence: string) => new MeitrackDecoder().push(framed(sentence));

describe('Meitrack', () => {
  it('decodes positions with the legacy expected values', () => {
    const [position] = positions(
      decode(
        '$$A158,79007001520234,AAA,35,40.996370,-8.575065,150730184834,A,8,24,0,1,1.3,173,32573389,31405012,268|3|2BC0|250B,2000,|||0A2D|0000,00000001,,50,,,,,,,,,,,,,*4A',
      ),
    );
    expect(position).toMatchObject({
      fixTime: Date.UTC(2015, 6, 30, 18, 48, 34),
      valid: true,
      latitude: 40.99637,
      longitude: -8.575065,
      altitudeM: 173,
    });
  });

  it('reads power in hundredths of a volt, inputs and outputs', () => {
    const [position] = positions(
      decode(
        '$$F160,861412043027965,AAA,22,45.499458,-82.493581,220718171428,V,0,0,0,0,0.0,0,227940,119812,302|220|D8D6|086E1B2B,0000,0000|0000|0000|0191|0573,,,3,,002134,0,0*FA',
      ),
    );
    expect(position?.attributes).toMatchObject({
      powerV: 13.95,
      batteryV: 4.01,
      input: 0,
      output: 0,
    });
    expect(position?.alarms).toEqual(['powerRestored']);
    const inputs = positions(
      decode(
        '$$F153,867144025101013,AAA,35,25.219431,55.279918,200916155923,V,0,25,0,0,0.0,0,249701532,98374503,424|2|101C|A3AE,0800,0000|0000|0000|02D3|0103,00000011,*A0',
      ),
    );
    expect(inputs[0]?.attributes.input).toBe(8);
  });

  it('reads voltages already given in volts', () => {
    const [position] = positions(
      decode(
        '$$D149,867047043162018,AAA,35,-1.264865,36.800705,211001105240,A,9,20,41.0,323,1,1697,1,0,000|00||,0000,4.33|12.96|1.92|2.72|2.69,0.000000|0|0.000000,*E1',
      ),
    );
    expect(position?.attributes).toMatchObject({ batteryV: 4.33, powerV: 12.96 });
    expect(position?.speedKmh).toBe(41);
  });

  it('decodes the AFF variant with its extra counter', () => {
    const [position] = positions(
      decode(
        '$$J163,123123123123123,AFF,0004,35,58.588926,16.180473,140928192856,A,10,27,0,161,1.2,19,1648894,435695,240|24|88B9|E435,0000,|||0A22|0000,00000001,,50,,,,,,,,,,,,,*70',
      ),
    );
    expect(position).toMatchObject({
      latitude: 58.588926,
      longitude: 16.180473,
      fixTime: Date.UTC(2014, 8, 28, 19, 28, 56),
    });
  });

  it('maps event codes to alarms', () => {
    const [sos] = positions(
      decode(
        '$$T143,869013024733944,AAA,1,18.459575,-69.947161,170220142912,A,5,15,10,300,1.6,115,3989,187884,370|2|5337|2B2C,0100,0000|0000|0000|0964|0B04,,*C2',
      ),
    );
    expect(sos?.alarms).toEqual(['sos']);
  });

  it('answers AAC and reads command replies', () => {
    const aac = decode('$$z27,861451040910625,AAC,1*D3');
    expect(aac.at(-1)?.acknowledgement?.toString()).toMatch(
      /^@@z27,861451040910625,AAC,1\*[0-9A-F]{2}\r\n$/,
    );
    const reply = new MeitrackDecoder().push(Buffer.from('$$u27,864606044993987,C01,OK*D6\r\n'));
    expect(reply.at(-1)).toEqual({ kind: 'commandResult', result: 'C01,OK' });
  });

  it('frames by the length field across split reads', () => {
    const decoder = new MeitrackDecoder();
    const frame =
      '$$K157,866771027160687,AAA,3,37.040231,10.042391,160412151656,A,10,11,0,48,0.8,21,1035518,774980,605|2|0010|307B,0400,0000|0000|0000|0A47|03E3,,,1,0000,001206*2C\r\n';
    expect(decoder.push(Buffer.from(frame.slice(0, 40)))).toEqual([]);
    expect(positions(decoder.push(Buffer.from(frame.slice(40))))).toHaveLength(1);
  });

  it('encodes commands exactly like the legacy encoder', () => {
    const decoder = new MeitrackDecoder();
    decoder.push(Buffer.from('$$z27,123456789012345,AAC,1*D3\r\n'));
    expect(decoder.encodeCommand({ type: 'custom', payload: { data: 'A10' } })?.toString()).toBe(
      '@@A25,123456789012345,A10*58\r\n',
    );
    expect(
      decoder
        .encodeCommand({ type: 'custom', payload: { data: 'C02,0,15360853789,Meitrack' } })
        ?.toString(),
    ).toBe('@@A48,123456789012345,C02,0,15360853789,Meitrack*8B\r\n');
    expect(decoder.encodeCommand({ type: 'engineStop', payload: {} })?.toString()).toMatch(
      /^@@A\d\d,123456789012345,C01,0,12222\*[0-9A-F]{2}\r\n$/,
    );
  });
});
