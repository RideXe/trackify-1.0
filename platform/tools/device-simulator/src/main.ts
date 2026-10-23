import { request } from 'node:http';
import { connect } from 'node:net';
import {
  gt06LoginFrame,
  gt06PositionFrame,
  teltonikaLoginFrame,
  teltonikaPositionFrame,
} from './frames';

const mode = process.argv[2] ?? 'phone';
const count = Number(process.argv[3] ?? 1);
if (!Number.isInteger(count) || count < 1 || count > 10_000)
  throw new Error('count must be 1..10000');

for (let index = 0; index < count; index += 1) {
  if (mode === 'phone') sendPhone(index);
  else if (mode === 'gt06') sendTracker(index, 5023, gt06LoginFrame, gt06PositionFrame);
  else if (mode === 'teltonika')
    sendTracker(index, 5027, teltonikaLoginFrame, teltonikaPositionFrame);
  else throw new Error('usage: npm start -- phone|gt06|teltonika [count]');
}

function sendPhone(index: number) {
  const endpoint = new URL(process.env.INGEST_URL ?? 'http://localhost:8082');
  endpoint.searchParams.set('id', uniqueId(index));
  endpoint.searchParams.set('lat', String(12.9716 + index / 1_000_000));
  endpoint.searchParams.set('lon', '77.5946');
  endpoint.searchParams.set('timestamp', String(Math.floor(Date.now() / 1000)));
  const req = request(endpoint, { method: 'POST' }, (response) => response.resume());
  req.on('error', (error) => console.error({ index, error }));
  req.end();
}

function sendTracker(
  index: number,
  defaultPort: number,
  loginFrame: (imei: string) => Buffer,
  positionFrame: (latitude: number, longitude: number) => Buffer,
) {
  const socket = connect(
    Number(process.env.TRACKER_PORT ?? defaultPort),
    process.env.TRACKER_HOST ?? 'localhost',
  );
  socket.once('connect', () => socket.write(loginFrame(uniqueId(index))));
  socket.once('data', () => socket.write(positionFrame(12.9716 + index / 1_000_000, 77.5946)));
  socket.on('data', () => socket.end());
  socket.on('error', (error) => console.error({ index, error }));
}

function uniqueId(index: number): string {
  const prefix = process.env.DEVICE_PREFIX ?? '35963210';
  return `${prefix}${String(index).padStart(15 - prefix.length, '0')}`;
}
