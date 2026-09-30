import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

export function notifierFromEnv(topicArn: string) {
  return new SnsNotifier(new SNSClient({}), topicArn);
}

/** Every photo for a vehicle lives under this prefix; anything else is not that vehicle's. */
export function photoPrefix(tenantId: string, deviceId: string) {
  return `tenants/${tenantId}/devices/${deviceId}/`;
}
