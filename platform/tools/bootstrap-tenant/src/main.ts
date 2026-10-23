import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArguments } from './arguments';

const input = parseArguments(process.argv.slice(2));
const created = aws([
  'cognito-idp',
  'admin-create-user',
  '--user-pool-id',
  input.userPoolId,
  '--username',
  input.email,
  '--user-attributes',
  `Name=email,Value=${input.email}`,
  'Name=email_verified,Value=true',
  '--desired-delivery-mediums',
  'EMAIL',
  '--region',
  input.region,
  '--output',
  'json',
]);
const result = JSON.parse(created) as {
  User?: { Attributes?: Array<{ Name?: string; Value?: string }> };
};
const subject = result.User?.Attributes?.find((attribute) => attribute.Name === 'sub')?.Value;
if (!subject) throw new Error('Cognito did not return the new user subject');

const tenantId = randomUUID();
const userId = randomUUID();
const transaction = [
  {
    Put: {
      TableName: input.coreTable,
      Item: {
        pk: { S: `TENANT#${tenantId}` },
        sk: { S: 'META' },
        tenantId: { S: tenantId },
        name: { S: input.tenantName },
        retentionDays: { N: '90' },
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    },
  },
  {
    Put: {
      TableName: input.coreTable,
      Item: {
        pk: { S: `TENANT#${tenantId}` },
        sk: { S: `USER#${userId}` },
        tenantId: { S: tenantId },
        userId: { S: userId },
        email: { S: input.email },
        role: { S: 'admin' },
        enabled: { BOOL: true },
        cognitoPk: { S: `COGNITO#${subject}` },
        cognitoSk: { S: `TENANT#${tenantId}` },
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    },
  },
];
aws([
  'dynamodb',
  'transact-write-items',
  '--transact-items',
  JSON.stringify(transaction),
  '--region',
  input.region,
]);
console.info(JSON.stringify({ tenantId, userId, email: input.email }, null, 2));

function aws(args: string[]): string {
  const result = spawnSync('aws', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `aws exited ${result.status}`);
  return result.stdout;
}
