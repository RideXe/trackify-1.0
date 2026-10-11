import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface PhotoStore {
  /** A short-lived URL the phone PUTs one JPEG to. */
  uploadUrl(key: string): Promise<string>;
  /** A short-lived URL an administrator's browser can show the photo from. */
  viewUrl(key: string): Promise<string>;
}

export interface Notifier {
  send(subject: string, message: string): Promise<void>;
}

/** Photos stay private: both directions go through presigned URLs that expire in minutes. */
export class S3PhotoStore implements PhotoStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  uploadUrl(key: string) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: 'image/jpeg' }),
      { expiresIn: 600 },
    );
  }

  viewUrl(key: string) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: 900,
    });
  }
}

/** Where the release script uploads the Android driver app. */
export const DRIVER_APP_KEY = 'android/trackify-driver.apk';

export interface DriverAppInfo {
  /** e.g. "1.0.2", from the upload's metadata. */
  version?: string;
  updatedAt?: number;
  sizeBytes?: number;
}

export interface DriverAppFile {
  /** Undefined until the release script has uploaded the app. */
  info(): Promise<DriverAppInfo | undefined>;
  /** A five-minute direct download, made fresh for each click of a shared link. */
  downloadUrl(): Promise<string>;
}

/** The driver app in its private bucket; nothing reaches it except through these URLs. */
export class S3DriverAppFile implements DriverAppFile {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async info(): Promise<DriverAppInfo | undefined> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: DRIVER_APP_KEY }),
      );
      return {
        version: head.Metadata?.version,
        updatedAt: head.LastModified?.getTime(),
        sizeBytes: head.ContentLength,
      };
    } catch (error) {
      if (error instanceof Error && (error.name === 'NotFound' || error.name === 'NoSuchKey'))
        return undefined;
      throw error;
    }
  }

  downloadUrl() {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: DRIVER_APP_KEY,
        ResponseContentDisposition: 'attachment; filename="trackify-driver.apk"',
        ResponseContentType: 'application/vnd.android.package-archive',
      }),
      { expiresIn: 300 },
    );
  }
}

/** Emails the fleet's alert address through its SNS topic subscription. */
export class SnsNotifier implements Notifier {
  constructor(
    private readonly client: SNSClient,
    private readonly topicArn: string,
  ) {}

  async send(subject: string, message: string) {
    await this.client.send(
      // SNS rejects email subjects of 100 characters or more.
      new PublishCommand({
        TopicArn: this.topicArn,
        Subject: subject.slice(0, 99),
        Message: message,
      }),
    );
  }
}

export function photoStoreFromEnv(bucket: string) {
  return new S3PhotoStore(new S3Client({}), bucket);
}

export function driverAppFileFromEnv(bucket: string) {
  return new S3DriverAppFile(new S3Client({}), bucket);
}

export function notifierFromEnv(topicArn: string) {
  return new SnsNotifier(new SNSClient({}), topicArn);
}

/** Every photo for a vehicle lives under this prefix; anything else is not that vehicle's. */
export function photoPrefix(tenantId: string, deviceId: string) {
  return `tenants/${tenantId}/devices/${deviceId}/`;
}

/** The sign-in accounts behind fleet users. Users sign in with their email address. */
export interface IdentityDirectory {
  /** Creates the account and emails a temporary password. Returns the Cognito subject. */
  invite(email: string): Promise<string>;
  setEnabled(subject: string, enabled: boolean): Promise<void>;
  remove(subject: string): Promise<void>;
}

/** Thrown when an email already has an account, possibly in another fleet. */
export class AccountExistsError extends Error {}

export class CognitoDirectory implements IdentityDirectory {
  constructor(
    private readonly client: CognitoIdentityProviderClient,
    private readonly userPoolId: string,
  ) {}

  async invite(email: string) {
    try {
      const result = await this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
          ],
          DesiredDeliveryMediums: ['EMAIL'],
        }),
      );
      const subject = result.User?.Attributes?.find((attribute) => attribute.Name === 'sub')?.Value;
      if (!subject) throw new Error('Cognito did not return the new user subject');
      return subject;
    } catch (error) {
      if (error instanceof Error && error.name === 'UsernameExistsException')
        throw new AccountExistsError('an account with this email already exists');
      throw error;
    }
  }

  async setEnabled(subject: string, enabled: boolean) {
    const input = { UserPoolId: this.userPoolId, Username: subject };
    await this.client.send(
      enabled ? new AdminEnableUserCommand(input) : new AdminDisableUserCommand(input),
    );
  }

  async remove(subject: string) {
    try {
      await this.client.send(
        new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: subject }),
      );
    } catch (error) {
      // Already gone is the outcome we wanted.
      if (!(error instanceof Error && error.name === 'UserNotFoundException')) throw error;
    }
  }
}

export function identityDirectoryFromEnv(userPoolId: string) {
  return new CognitoDirectory(new CognitoIdentityProviderClient({}), userPoolId);
}

/** Announcements are delivered by the notification service, which subscribes to this topic. */
export function announcementQueueFromEnv(topicArn: string | undefined) {
  if (!topicArn) return undefined;
  const client = new SNSClient({});
  return {
    async publish(tenantId: string, announcementId: string) {
      await client.send(
        new PublishCommand({
          TopicArn: topicArn,
          Message: JSON.stringify({ tenantId, announcementId }),
        }),
      );
    },
  };
}
