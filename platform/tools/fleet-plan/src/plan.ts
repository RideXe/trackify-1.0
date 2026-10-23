import { UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { tenantPartitionKey } from '@trackify/data';
import {
  isSubscriptionPlan,
  planFastestIntervalSeconds,
  subscriptionPlans,
  type SubscriptionPlan,
} from '@trackify/domain';

export interface PlanArguments {
  tenantId: string;
  plan: SubscriptionPlan;
  coreTable: string;
}

export function parseArguments(values: string[]): PlanArguments {
  const options = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || !value) throw usage();
    options.set(key.slice(2), value);
  }
  const tenantId = options.get('tenant-id');
  const plan = options.get('plan');
  const coreTable = options.get('core-table');
  if (!tenantId || !coreTable || !isSubscriptionPlan(plan)) throw usage();
  return { tenantId, plan, coreTable };
}

function usage() {
  return new Error(
    `usage: npm start -w @trackify/fleet-plan -- --tenant-id TENANT --plan ${subscriptionPlans.join('|')} --core-table TABLE`,
  );
}

/**
 * Sets a fleet's subscription plan. Vehicles set faster than the new plan allows slow down to its
 * limit at once (the limit is applied when settings are read), and speed up again on upgrade.
 */
export async function setPlan(client: Pick<DynamoDBDocumentClient, 'send'>, input: PlanArguments) {
  const result = await client.send(
    new UpdateCommand({
      TableName: input.coreTable,
      Key: { pk: tenantPartitionKey(input.tenantId), sk: 'META' },
      UpdateExpression: 'SET #plan = :plan',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: { '#plan': 'plan' },
      ExpressionAttributeValues: { ':plan': input.plan },
      ReturnValues: 'ALL_OLD',
    }),
  );
  return {
    tenantId: input.tenantId,
    previousPlan: (result.Attributes?.plan as string | undefined) ?? '(default)',
    plan: input.plan,
    fastestSyncSeconds: planFastestIntervalSeconds[input.plan],
  };
}
