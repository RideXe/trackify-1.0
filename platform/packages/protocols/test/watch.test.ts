import { describe, expect, it } from 'vitest';
import { WatchDecoder, type ProtocolPacket } from '../src/index';

// Frames and expected values come from the legacy server's watch decoder tests.
const positions = (packets: ProtocolPacket[]) =>
  packets.flatMap((packet) => (packet.kind === 'positions' ? packet.positions : []));
const decode = (frame: string) => new WatchDecoder().push(Buffer.from(frame, 'ascii'));
/** Builds a frame with a correct length field around legacy message content. */
const frame = (prefix: string, content: string) =>
  `[${prefix}*${content.length.toString(16).padStart(4, '0')}*${content}]`;

describe('watch protocol', () => {
  it('decodes positions with the legacy expected values', () => {
    const [position] = positions(
      decode(
        '[SG*8800000015*0087*UD,220414,134652,A,22.571707,N,113.8613968,E,0.1,0.0,100,7,60,90,1000,50,0000,4,1,460,0,9360,4082,131,9360,4092,148,9360,4091,143,9360,4153,141]',
      ),
    );
    expect(position).toMatchObject({
      fixTime: Date.UTC(2014, 3, 22, 13, 46, 52),
      valid: true,
      speedKmh: 0.1,
      altitudeM: 100,
    });
    expect(position?.latitude).toBeCloseTo(22.57171, 4);
    expect(position?.longitude).toBeCloseTo(113.8614, 4);
    expect(position?.attributes).toMatchObject({ satellites: 7, batteryLevel: 90, steps: 1000 });
  });

  it('keeps signed coordinates without negating twice', () => {
    const [position] = positions(
      decode(
        '[3G*6105117105*008D*UD2,210716,231601,V,-33.480366,N,-70.7630692,E,0.00,0.0,0.0,0,100,34,0,0,00000000,3,255,730,2,29731,54315,167,29731,54316,162,29731,54317,145]',
      ),
    );
    expect(position?.latitude).toBeCloseTo(-33.48037, 4);
    expect(position?.longitude).toBeCloseTo(-70.76307, 4);
    const west = positions(
      decode(
        frame(
          '3G*6430073509',
          'UD2,241016,081622,V,09.951861,N,-84.1422119,W,0.00,0.0,0.0,0,39,94,0,0,00000000,1,0,712,3,2007,18961,123',
        ),
      ),
    )[0];
    expect(west?.longitude).toBeCloseTo(-84.14221, 4);
  });

  it('reads alarm status bits and answers alarm messages', () => {
    const packets = decode(
      '[3G*6907919734*003e*AL_LTE,170525,214118,V,0,N,0,E,0,0,0,0,0,22,0,0,00010000,0,0,0]',
    );
    expect(positions(packets)[0]?.alarms).toEqual(['sos']);
    expect(packets.at(-1)?.acknowledgement?.toString()).toBe('[3G*6907919734*0002*AL]');
    const removed = positions(
      decode(
        frame(
          'ZJ*689466020014198*0003',
          'AL,221121,085515,V,00.000000,N,000.000000,E,0,0,0,0,0,44,0,0,00100000,1,255,460,0,16399,234887445,0',
        ),
      ),
    );
    expect(removed[0]?.alarms).toEqual(['removing']);
  });

  it('answers link keep-alives with the index when the watch sends one', () => {
    const plain = decode('[3G*4700186508*000B*LK,0,10,100]');
    expect(plain.at(-1)).toMatchObject({
      kind: 'status',
      status: { attributes: { batteryLevel: 100 } },
    });
    expect(plain.at(-1)?.acknowledgement?.toString()).toBe('[3G*4700186508*0002*LK]');
    const indexed = new WatchDecoder().push(Buffer.from('[ZJ*5678901234*0001*0002*LK]'));
    expect(indexed.at(-1)?.acknowledgement?.toString()).toBe('[ZJ*5678901234*0001*0002*LK]');
  });

  it('frames by the length field, across split reads and back-to-back messages', () => {
    const decoder = new WatchDecoder();
    const one = '[SG*8800000015*0002*LK]';
    const two =
      '[SG*9059056143*0053*UD,251021,223408,A,41.46500,N,081.53128,W,0.926,000,0,00,70,70,0,50,00000000,0,1,,,,00]';
    expect(
      decoder.push(Buffer.from(`noise${one}${two.slice(0, 30)}`)).map((packet) => packet.kind),
    ).toEqual(['identity', 'status']);
    const rest = decoder.push(Buffer.from(two.slice(30)));
    expect(positions(rest)[0]?.longitude).toBeCloseTo(-81.53128, 4);
  });
});
