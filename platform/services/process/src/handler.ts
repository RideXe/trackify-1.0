import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import {
  createDocumentClient,
  DynamoFleetProcessingStore,
  type FleetProcessingStore,
} from '@trackify/data';
import { parsePositionMessage } from '@trackify/domain';
import { geocoderFromEnv } from '@trackify/geocoder';
import { AppSyncPositionPublisher, type PositionPublisher } from '@trackify/realtime';

export function createHandler(store: FleetProcessingStore, publisher?: PositionPublisher) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: SQSBatchResponse['batchItemFailures'] = [];
    const failedGroups = new Set<string>();
    for (const record of event.Records) {
      const groupId = record.attributes.MessageGroupId ?? record.messageId;
      if (failedGroups.has(groupId)) {
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }
      try {
        const parsed = parsePositionMessage(JSON.parse(record.body));
        if (!parsed.success) throw new Error('invalid position message');
        const result = await store.process(parsed.data);
        const { deviceId, fixTime } = parsed.data;
        // One line per notable outcome: searchable when a vehicle's map or trips look wrong.
        if (result.skipped && result.skipped !== 'late')
          console.info('position skipped', { deviceId, fixTime, reason: result.skipped });
        if (result.trip)
          console.info('trip completed', {
            deviceId,
            tripId: result.trip.tripId,
            distanceM: result.trip.distanceM,
            minutes: Math.round((result.trip.endTime - result.trip.startTime) / 60_000),
          });
        // Publish where the vehicle now shows, not the raw fix: GPS drift must not move the live
        // map, and readings that only went into history must not move it at all.
        if (!result.duplicate && result.live)
          await publisher?.publish(
            { ...(result.position ?? parsed.data), ...result.live },
            result.groupId,
          );
      } catch (error) {
        console.error('position processing failed', { messageId: record.messageId, error });
        failedGroups.add(groupId);
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}

function storeFromEnvironment(): FleetProcessingStore {
  const required = (key: string) => {
    const value = process.env[key];
    if (!value) throw new Error(`${key} is required`);
    return value;
  };
  return new DynamoFleetProcessingStore(
    createDocumentClient(),
    {
      core: required('CORE_TABLE'),
      positions: required('POSITIONS_TABLE'),
      state: required('DEVICE_STATE_TABLE'),
      events: required('EVENTS_TABLE'),
      trips: required('TRIPS_TABLE'),
      dailyStats: required('DAILY_STATS_TABLE'),
    },
    Date.now,
    geocoderFromEnv(),
  );
}

const realtimeDns = process.env.REALTIME_HTTP_DNS;
export const handler = createHandler(
  storeFromEnvironment(),
  realtimeDns
    ? new AppSyncPositionPublisher(realtimeDns, process.env.AWS_REGION ?? 'ap-south-1')
    : undefined,
);
