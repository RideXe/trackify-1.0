import type { PositionMessage } from '@trackify/domain';

export function devicePartitionKey(tenantId: string, deviceId: string): string {
  return `TENANT#${tenantId}#DEVICE#${deviceId}`;
}

export function positionSortKey(position: Pick<PositionMessage, 'fixTime' | 'messageId'>): string {
  return `${String(position.fixTime).padStart(13, '0')}#${position.messageId}`;
}

export function uniqueIdLookupKey(uniqueId: string): string {
  return `UNIQUEID#${uniqueId}`;
}

export function tenantPartitionKey(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

export function cognitoLookupKey(subject: string): string {
  return `COGNITO#${subject}`;
}

export function ttlSeconds(fixTimeMs: number, retentionDays: number): number {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3_650) {
    throw new Error('retentionDays must be an integer from 1 to 3650');
  }
  return Math.floor(fixTimeMs / 1000) + retentionDays * 86_400;
}
