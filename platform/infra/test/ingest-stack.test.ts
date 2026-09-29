import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../lib/config';
import { DataStack } from '../lib/stacks/data-stack';
import { IngestStack } from '../lib/stacks/ingest-stack';

const context = { env: 'dev', account: '123456789012', alertEmail: 'alerts@example.com' };

function synth() {
  const app = new App();
  const config = loadConfig((key) => context[key as keyof typeof context]);
  const data = new DataStack(app, 'Data', { config });
  const stack = new IngestStack(app, 'Ingest', {
    config,
    data,
    platformPath: new URL('../..', import.meta.url).pathname,
  });
  return Template.fromStack(stack);
}

interface PolicyStatement {
  Action: string | string[];
  Resource: unknown;
}

describe('IngestStack', () => {
  it('creates FIFO queues, ARM Lambdas and a partial-batch event source', () => {
    const template = synth();
    template.resourceCountIs('AWS::SQS::Queue', 2);
    template.hasResourceProperties('AWS::SQS::Queue', { FifoQueue: true });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
      MemorySize: 256,
    });
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      EventSourceArn: Match.anyValue(),
    });
    template.resourceCountIs('AWS::Lambda::Url', 0);
  });

  it('lets the processor read the previous device state it replaces', () => {
    const statements = Object.values(synth().findResources('AWS::IAM::Policy')).flatMap(
      (policy) =>
        (policy as { Properties: { PolicyDocument: { Statement: PolicyStatement[] } } }).Properties
          .PolicyDocument.Statement,
    );
    const deviceStateActions = statements
      .filter((statement) => JSON.stringify(statement.Resource).includes('DeviceState'))
      .flatMap((statement) => [statement.Action].flat());
    expect(deviceStateActions).toEqual(
      expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:PutItem']),
    );
  });
});
