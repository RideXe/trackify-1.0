import { crc16Ibm, crc16X25 } from '@trackify/protocols';

export function gt06LoginFrame(imei: string, serial = 1): Buffer {
  if (!/^\d{15}$/.test(imei)) throw new Error('GT06 IMEI must contain 15 digits');
  return gt06Frame(0x01, Buffer.from(`0${imei}`, 'hex'), serial);
}

export function gt06PositionFrame(
  latitude: number,
  longitude: number,
  timestamp = new Date(),
  serial = 2,
): Buffer {
  const payload = Buffer.alloc(18);
  payload[0] = timestamp.getUTCFullYear() - 2000;
  payload[1] = timestamp.getUTCMonth() + 1;
  payload[2] = timestamp.getUTCDate();
  payload[3] = timestamp.getUTCHours();
  payload[4] = timestamp.getUTCMinutes();
  payload[5] = timestamp.getUTCSeconds();
  payload[6] = 0xc0 | 12;
  payload.writeUInt32BE(Math.round(Math.abs(latitude) * 1_800_000), 7);
  payload.writeUInt32BE(Math.round(Math.abs(longitude) * 1_800_000), 11);
  payload[15] = 40;
  let courseStatus = 0x1000 | 180;
  if (latitude >= 0) courseStatus |= 0x0400;
  if (longitude < 0) courseStatus |= 0x0800;
  payload.writeUInt16BE(courseStatus, 16);
  return gt06Frame(0x12, payload, serial);
}

export function teltonikaLoginFrame(imei: string): Buffer {
  if (!/^\d{15}$/.test(imei)) throw new Error('Teltonika IMEI must contain 15 digits');
  const value = Buffer.from(imei, 'ascii');
  const frame = Buffer.alloc(value.length + 2);
  frame.writeUInt16BE(value.length);
  value.copy(frame, 2);
  return frame;
}

export function teltonikaPositionFrame(
  latitude: number,
  longitude: number,
  timestamp = Date.now(),
): Buffer {
  const record = Buffer.alloc(32);
  let offset = 0;
  record.writeBigUInt64BE(BigInt(timestamp), offset);
  offset += 8;
  record[offset++] = 0;
  record.writeInt32BE(Math.round(longitude * 10_000_000), offset);
  offset += 4;
  record.writeInt32BE(Math.round(latitude * 10_000_000), offset);
  offset += 4;
  record.writeInt16BE(0, offset);
  offset += 2;
  record.writeUInt16BE(180, offset);
  offset += 2;
  record[offset++] = 12;
  record.writeUInt16BE(40, offset);
  offset += 2;
  record[offset++] = 239;
  record[offset++] = 1;
  record[offset++] = 1;
  record[offset++] = 239;
  record[offset++] = 1;
  record[offset++] = 0;
  record[offset++] = 0;
  record[offset] = 0;
  const data = Buffer.concat([Buffer.from([0x08, 1]), record, Buffer.from([1])]);
  const frame = Buffer.alloc(data.length + 12);
  frame.writeUInt32BE(data.length, 4);
  data.copy(frame, 8);
  frame.writeUInt32BE(crc16Ibm(data), 8 + data.length);
  return frame;
}

function gt06Frame(protocol: number, payload: Buffer, serial: number): Buffer {
  const length = 1 + payload.length + 2 + 2;
  const frame = Buffer.alloc(length + 5);
  frame.writeUInt16BE(0x7878, 0);
  frame[2] = length;
  frame[3] = protocol;
  payload.copy(frame, 4);
  frame.writeUInt16BE(serial, 4 + payload.length);
  frame.writeUInt16BE(crc16X25(frame.subarray(2, 6 + payload.length)), 6 + payload.length);
  frame.writeUInt16BE(0x0d0a, 8 + payload.length);
  return frame;
}
