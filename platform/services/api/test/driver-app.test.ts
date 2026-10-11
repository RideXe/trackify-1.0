import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createDownloadHandler, driverAppRoutes } from '../src/driver-app';

const file = (uploaded = true) => ({
  info: vi
    .fn()
    .mockResolvedValue(
      uploaded ? { version: '1.0.2', updatedAt: 5, sizeBytes: 45_000_000 } : undefined,
    ),
  downloadUrl: vi.fn().mockResolvedValue('https://bucket.s3/signed'),
});
const links = (valid = true) => ({
  create: vi.fn().mockResolvedValue({ token: 'a'.repeat(32), expiresAt: 86_400_000 }),
  valid: vi.fn().mockResolvedValue(valid),
});
const event = (method: string, path: string) =>
  ({
    rawPath: path,
    requestContext: { http: { method }, domainName: 'api.example' },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
const member = (role: string) => ({ tenantId: 't', userId: 'u', role, email: 'a@b.in' });

describe('driver app links', () => {
  it('makes a 24-hour link on the API domain for staff', async () => {
    const store = links();
    const result = await driverAppRoutes(
      file(),
      store,
      () => 0,
    )(event('POST', '/driver-app/links'), member('dispatcher'));
    expect(result?.statusCode).toBe(201);
    expect(JSON.parse(result!.body)).toMatchObject({
      url: `https://api.example/driver-app/${'a'.repeat(32)}`,
      expiresAt: 86_400_000,
      version: '1.0.2',
    });
    expect(store.create).toHaveBeenCalledWith('t', 'a@b.in', 0);
  });

  it('refuses viewers, and says so plainly before the app is published', async () => {
    const routes = driverAppRoutes(file(false), links());
    expect((await routes(event('POST', '/driver-app/links'), member('viewer')))?.statusCode).toBe(
      403,
    );
    const missing = await routes(event('POST', '/driver-app/links'), member('admin'));
    expect(missing?.statusCode).toBe(404);
    const info = await routes(event('GET', '/driver-app'), member('viewer'));
    expect(JSON.parse(info!.body)).toEqual({ available: false });
  });
});

describe('public download', () => {
  const download = (token: string) =>
    ({ pathParameters: { token } }) as unknown as APIGatewayProxyEventV2;

  it('sends a valid link straight to a fresh short download', async () => {
    const result = await createDownloadHandler(file(), links(true))(download('a'.repeat(32)));
    expect(result).toMatchObject({
      statusCode: 302,
      headers: { location: 'https://bucket.s3/signed' },
    });
  });

  it('shows a plain page, not a download, for an expired or made-up link', async () => {
    const appFile = file();
    const result = await createDownloadHandler(appFile, links(false))(download('nope'));
    expect(result.statusCode).toBe(410);
    expect(result.body).toContain('This download link has expired');
    expect(appFile.downloadUrl).not.toHaveBeenCalled();
  });
});
