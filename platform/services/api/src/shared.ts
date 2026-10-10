import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  createDocumentClient,
  DynamoFleetStore,
  DynamoShareStore,
  type ShareLink,
} from '@trackify/data';
import { requiredEnv, response } from './http';

interface SharedData {
  resolve(token: string): Promise<ShareLink | undefined>;
  device(tenantId: string, deviceId: string): Promise<{ name: string } | undefined>;
  state(
    tenantId: string,
    deviceId: string,
  ): Promise<
    | {
        latitude?: number;
        longitude?: number;
        speedKmh?: number;
        courseDeg?: number;
        fixTime?: number;
        status?: string;
      }
    | undefined
  >;
}

/**
 * The public side of share links: no sign-in, so it returns only what the link is for — one
 * vehicle's name and live position — and the same "not found" for wrong, revoked or expired links.
 */
export function createSharedHandler(data: SharedData) {
  return async (event: APIGatewayProxyEventV2) => {
    const token = /^\/shared\/([A-Za-z0-9_-]{32})$/.exec(event.rawPath)?.[1];
    const notFound = response(404, { message: 'this link is not valid or has expired' });
    if (!token) return notFound;
    try {
      const link = await data.resolve(token);
      if (!link) return notFound;
      const [device, state] = await Promise.all([
        data.device(link.tenantId, link.deviceId),
        data.state(link.tenantId, link.deviceId),
      ]);
      if (!device) return notFound;
      return response(200, {
        name: device.name,
        expiresAt: link.expiresAtMs,
        position:
          state?.latitude !== undefined && state.longitude !== undefined
            ? {
                latitude: state.latitude,
                longitude: state.longitude,
                speedKmh: state.speedKmh ?? 0,
                courseDeg: state.courseDeg ?? 0,
                fixTime: state.fixTime,
                status: state.status,
              }
            : null,
      });
    } catch (error) {
      console.error('shared location failed', error);
      return response(503, { message: 'temporarily unavailable' });
    }
  };
}

const client = createDocumentClient();
const shares = new DynamoShareStore(client, requiredEnv('CORE_TABLE'));
const fleet = new DynamoFleetStore(
  client,
  requiredEnv('CORE_TABLE'),
  requiredEnv('DEVICE_STATE_TABLE'),
  '',
);
export const handler = createSharedHandler({
  resolve: (token) => shares.resolve(token),
  device: (tenantId, deviceId) => fleet.getDevice(tenantId, deviceId),
  state: (tenantId, deviceId) => fleet.deviceState(tenantId, deviceId),
});
