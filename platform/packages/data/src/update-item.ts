import { GetCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * SET/REMOVE update of an existing item: null removes a field, undefined leaves it alone.
 * Returns the updated item, or undefined when it does not exist.
 */
export async function updateItem(
  client: DynamoDBDocumentClient,
  tableName: string,
  key: { pk: string; sk: string },
  changes: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
  if (!entries.length) {
    const existing = await client.send(new GetCommand({ TableName: tableName, Key: key }));
    return existing.Item;
  }
  const sets = entries.filter(([, value]) => value !== null);
  const removes = entries.filter(([, value]) => value === null).map(([field]) => field);
  const clauses = [
    sets.length ? `SET ${sets.map(([field]) => `#${field} = :${field}`).join(', ')}` : '',
    removes.length ? `REMOVE ${removes.map((field) => `#${field}`).join(', ')}` : '',
  ].filter(Boolean);
  try {
    const result = await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: clauses.join(' '),
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeNames: Object.fromEntries(
          [...sets.map(([field]) => field), ...removes].map((field) => [`#${field}`, field]),
        ),
        ...(sets.length
          ? { ExpressionAttributeValues: Object.fromEntries(sets.map(([k, v]) => [`:${k}`, v])) }
          : {}),
        ReturnValues: 'ALL_NEW',
      }),
    );
    return result.Attributes;
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException')
      return undefined;
    throw error;
  }
}
