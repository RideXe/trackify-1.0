import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { loadConfig } from '../lib/config';
import { DataStack } from '../lib/stacks/data-stack';

const context = { env: 'dev', account: '123456789012', alertEmail: 'alerts@example.com' };

describe('DataStack', () => {
  it('creates on-demand tables with TTL, streams and required indexes', () => {
    const app = new App();
    const config = loadConfig((key) => context[key as keyof typeof context]);
    const template = Template.fromStack(new DataStack(app, 'Data', { config }));
    template.resourceCountIs('AWS::DynamoDB::Table', 9);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    });
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      StreamSpecification: { StreamViewType: 'NEW_AND_OLD_IMAGES' },
    });
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: 'byCognitoSub', Projection: { ProjectionType: 'ALL' } }),
      ]),
    });
  });
});
