import type { EventMessage, PositionMessage } from '@trackify/domain';

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

const pad = (time: number) => String(time).padStart(13, '0');

/** The Events-table row for an event; every writer uses this so readers see one format. */
export function eventItem(event: EventMessage, expiresAt: number) {
  return {
    pk: devicePartitionKey(event.tenantId, event.deviceId),
    sk: `${pad(event.eventTime)}#${event.eventId}`,
    ...event,
    tenantMonthPk: `${event.tenantId}#${new Date(event.eventTime).toISOString().slice(0, 7)}`,
    tenantMonthSk: `${pad(event.eventTime)}#${event.eventId}`,
    expiresAt,
  };
}
