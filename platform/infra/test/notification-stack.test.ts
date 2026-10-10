import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../lib/config';
import { DataStack } from '../lib/stacks/data-stack';
import { NotificationStack } from '../lib/stacks/notification-stack';

function template(extra: Record<string, string> = {}) {
  const context: Record<string, string> = {
    env: 'dev',
    account: '123456789012',
    alertEmail: 'alerts@example.com',
    ...extra,
  };
  const app = new App();
  const config = loadConfig((key) => context[key]);
  const data = new DataStack(app, 'Data', { config });
  const stack = new NotificationStack(app, 'Notifications', {
    config,
    data,
    platformPath: new URL('../..', import.meta.url).pathname,
  });
  return Template.fromStack(stack);
}

describe('NotificationStack', () => {
  it('reads only new events from the stream, with retries and a dead-letter queue', () => {
    template().hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      StartingPosition: 'LATEST',
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      MaximumRetryAttempts: 10,
      FilterCriteria: { Filters: [{ Pattern: JSON.stringify({ eventName: ['INSERT'] }) }] },
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
    });
  });

  it('lets SMS reach phone numbers without granting publish to every topic', () => {
    template().hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'sns:Publish', NotResource: 'arn:aws:sns:*:*:*' }),
        ]),
      },
    });
  });

  it('creates an SES sender identity only when an email sender is configured', () => {
    template().resourceCountIs('AWS::SES::EmailIdentity', 0);
    const withSender = template({ emailSender: 'alerts@fleet.example' });
    withSender.resourceCountIs('AWS::SES::EmailIdentity', 1);
    withSender.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ EMAIL_SENDER: 'alerts@fleet.example' }) },
    });
  });

  it('rejects an invalid email sender', () => {
    expect(() => template({ emailSender: 'not-an-email' })).toThrow(/emailSender/);
  });
});
