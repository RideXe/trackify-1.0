import { createServer } from 'node:net';
import { SQSClient } from '@aws-sdk/client-sqs';
import { createDocumentClient, DynamoDeviceDirectory } from '@trackify/data';
import { Gt06Decoder, TeltonikaDecoder, type ProtocolDecoder } from '@trackify/protocols';
import { GatewaySession, SqsQueueWriter } from './session';

const coreTable = required('CORE_TABLE');
const queueUrl = required('INGEST_QUEUE_URL');
const devices = new DynamoDeviceDirectory(createDocumentClient(), coreTable);
const queue = new SqsQueueWriter(new SQSClient({}), queueUrl);

start(5023, () => new Gt06Decoder());
start(5027, () => new TeltonikaDecoder());

function start(port: number, decoder: () => ProtocolDecoder) {
  const server = createServer((socket) => {
    socket.setKeepAlive(true, 60_000);
    socket.setTimeout(15 * 60_000, () => socket.destroy());
    const session = new GatewaySession(socket, decoder(), devices, queue);
    socket.on('data', (chunk) => session.receive(chunk));
    socket.on('error', (error) => console.warn('tracker socket error', { port, error }));
  });
  server.maxConnections = 20_000;
  server.listen(port, '0.0.0.0', () => console.info('tracker listener ready', { port }));
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
