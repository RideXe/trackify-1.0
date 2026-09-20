import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

export type OnboardingStatus = 'waiting' | 'activated' | 'revoked';

export interface OnboardingInvitation {
  codeHash: string;
  tenantId: string;
  deviceId: string;
  deviceName: string;
  uniqueId: string;
  retentionDays: number;
  status: OnboardingStatus;
  createdAt: number;
  expiresAt?: number;
  activatedAt?: number;
}

export class DynamoOnboardingStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async create(invitation: OnboardingInvitation) {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...invitation,
          devicePk: deviceKey(invitation.tenantId, invitation.deviceId),
        },
        ConditionExpression: 'attribute_not_exists(codeHash)',
      }),
    );
    return invitation;
  }

  async list(tenantId: string, deviceId: string): Promise<OnboardingInvitation[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'byDevice',
        KeyConditionExpression: 'devicePk = :device',
        ExpressionAttributeValues: { ':device': deviceKey(tenantId, deviceId) },
        ScanIndexForward: false,
      }),
    );
    return (result.Items ?? []).map(toInvitation);
  }

  async revoke(tenantId: string, codeHash: string): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { codeHash },
          UpdateExpression: 'SET #status = :revoked, revokedAt = :now REMOVE credentialHash',
          ConditionExpression: 'tenantId = :tenant AND #status <> :revoked',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':tenant': tenantId,
            ':revoked': 'revoked',
            ':now': Date.now(),
          },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw error;
    }
  }

  async redeem(codeHash: string, credentialHash: string, now: number) {
    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { codeHash },
          UpdateExpression:
            'SET #status = :activated, activatedAt = :now, credentialHash = :credential REMOVE expiresAt',
          ConditionExpression: '#status = :waiting AND expiresAt > :nowSeconds',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':waiting': 'waiting',
            ':activated': 'activated',
            ':now': now,
            ':nowSeconds': Math.floor(now / 1000),
            ':credential': credentialHash,
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return result.Attributes ? toInvitation(result.Attributes) : undefined;
    } catch (error) {
      if (isConditionalFailure(error)) return undefined;
      throw error;
    }
  }

  async resolveCredential(credentialHash: string): Promise<OnboardingInvitation | undefined> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'byCredential',
        KeyConditionExpression: 'credentialHash = :credential',
        ExpressionAttributeValues: { ':credential': credentialHash },
        Limit: 2,
      }),
    );
    if ((result.Count ?? 0) > 1) throw new Error('duplicate device credential');
    const item = result.Items?.[0];
    if (!item || item.status !== 'activated') return undefined;
    return toInvitation(item);
  }
}

function deviceKey(tenantId: string, deviceId: string) {
  return `TENANT#${tenantId}#DEVICE#${deviceId}`;
}

function toInvitation(item: Record<string, unknown>): OnboardingInvitation {
  return {
    codeHash: String(item.codeHash),
    tenantId: String(item.tenantId),
    deviceId: String(item.deviceId),
    deviceName: String(item.deviceName),
    uniqueId: String(item.uniqueId),
    retentionDays: Number(item.retentionDays ?? 90),
    status: item.status as OnboardingStatus,
    createdAt: Number(item.createdAt),
    expiresAt: item.expiresAt === undefined ? undefined : Number(item.expiresAt),
    activatedAt: item.activatedAt === undefined ? undefined : Number(item.activatedAt),
  };
}

function isConditionalFailure(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ConditionalCheckFailedException'
  );
}
