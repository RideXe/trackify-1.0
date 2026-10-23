import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import type { DriverAppFile } from './aws';
import { response } from './http';

export interface DownloadLinks {
  create(
    tenantId: string,
    createdBy: string,
    now?: number,
  ): Promise<{ token: string; expiresAt: number }>;
  valid(token: string, now?: number): Promise<boolean>;
}

/**
 * Signed-in routes for the dashboard's "Driver app" button: whether the app has been uploaded,
 * and a fresh 24-hour link to share with a driver. Viewers cannot create links.
 */
export function driverAppRoutes(file: DriverAppFile, links: DownloadLinks, now = Date.now) {
  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
    membership: { tenantId: string; userId: string; role: string; email?: string },
  ) => {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    if (method === 'GET' && path === '/driver-app') {
      const info = await file.info();
      return response(200, info ? { available: true, ...info } : { available: false });
    }
    if (method === 'POST' && path === '/driver-app/links') {
      if (membership.role === 'viewer')
        return response(403, { message: 'dispatcher role required' });
      const info = await file.info();
      if (!info) return response(404, { message: 'The driver app has not been published yet.' });
      const link = await links.create(
        membership.tenantId,
        membership.email ?? membership.userId,
        now(),
      );
      return response(201, {
        url: `https://${event.requestContext.domainName}/driver-app/${link.token}`,
        expiresAt: link.expiresAt,
        ...info,
      });
    }
    return undefined;
  };
}

/**
 * The public end of a shared link: a valid code sends the phone straight to a five-minute
 * download; anything else gets a short page in plain words instead of an error.
 */
export function createDownloadHandler(file: DriverAppFile, links: DownloadLinks, now = Date.now) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const token = event.pathParameters?.token ?? '';
    try {
      if (!(await links.valid(token, now())))
        return page(
          410,
          'This download link has expired',
          'Links work for 24 hours. Ask your office to send a new link to the Trackify driver app.',
        );
      return {
        statusCode: 302,
        headers: { location: await file.downloadUrl(), 'cache-control': 'no-store' },
        body: '',
      };
    } catch (error) {
      console.error('driver app download failed', error);
      return page(503, 'Download unavailable', 'Please try again in a minute.');
    }
  };
}

function page(statusCode: number, title: string, text: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px;color:#101828"><h1 style="font-size:22px">${title}</h1><p style="color:#475467;line-height:1.5">${text}</p></body></html>`,
  };
}
