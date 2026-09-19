import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { loadConfig } from '../lib/config';
import { DataStack } from '../lib/stacks/data-stack';
import { IngestStack } from '../lib/stacks/ingest-stack';

const context = { env: 'dev', account: '123456789012', alertEmail: 'alerts@example.com' };

describe('IngestStack', () => {
  it('creates FIFO queues, ARM Lambdas and a partial-batch event source', () => {
    const app = new App();
    const config = loadConfig((key) => context[key as keyof typeof context]);
    const data = new DataStack(app, 'Data', { config });
    const stack = new IngestStack(app, 'Ingest', {
      config,
      data,
      platformPath: new URL('../..', import.meta.url).pathname,
    });
    const template = Template.fromStack(stack);
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
    template.resourceCountIs('AWS::Lambda::Url', 1);
  });
});
