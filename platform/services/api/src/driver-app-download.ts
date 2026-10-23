import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createDocumentClient, DynamoDownloadLinkStore } from '@trackify/data';
import { driverAppFileFromEnv } from './aws';
import { createDownloadHandler } from './driver-app';

let download: ReturnType<typeof createDownloadHandler> | undefined;

/** GET /driver-app/{token}: public, so it runs without the sign-in check of the other routes. */
export const handler = (event: APIGatewayProxyEventV2) => {
  download ??= createDownloadHandler(
    driverAppFileFromEnv(requiredEnv('DRIVER_APP_BUCKET')),
    new DynamoDownloadLinkStore(createDocumentClient(), requiredEnv('CORE_TABLE')),
  );
  return download(event);
};

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}
