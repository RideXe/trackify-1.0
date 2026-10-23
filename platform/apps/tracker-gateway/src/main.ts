import { createServer } from 'node:net';
import { SQSClient } from '@aws-sdk/client-sqs';
import { createDocumentClient, DynamoCommandStore, DynamoDeviceDirectory } from '@trackify/data';
import { createDecoder, trackerProtocols, type ProtocolDecoder } from '@trackify/protocols';
import { CommandDispatcher, commandResults } from './commands';
import { GatewaySession, SqsQueueWriter, type SessionRegistry } from './session';

const coreTable = required('CORE_TABLE');
const queueUrl = required('INGEST_QUEUE_URL');
const client = createDocumentClient();
const devices = new DynamoDeviceDirectory(client, coreTable);
const queue = new SqsQueueWriter(new SQSClient({}), queueUrl);
const commands = new DynamoCommandStore(
  client,
  required('COMMANDS_TABLE'),
  required('EVENTS_TABLE'),
);
const sessions: SessionRegistry = new Map();
const results = commandResults(commands);

for (const [protocol, { port }] of Object.entries(trackerProtocols))
  start(port, createDecoder[protocol as keyof typeof trackerProtocols]);
new CommandDispatcher(commands, sessions).start();

function start(port: number, decoder: () => ProtocolDecoder) {
  const server = createServer((socket) => {
    socket.setKeepAlive(true, 60_000);
    socket.setTimeout(15 * 60_000, () => socket.destroy());
    const session = new GatewaySession(
      socket,
      decoder(),
      devices,
      queue,
      Date.now,
      sessions,
      results,
    );
    socket.on('data', (chunk) => session.receive(chunk));
    socket.on('close', () => session.close());
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
