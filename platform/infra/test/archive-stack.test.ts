import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { loadConfig } from '../lib/config';
import { ArchiveStack } from '../lib/stacks/archive-stack';
import { DataStack } from '../lib/stacks/data-stack';

const context = { env: 'dev', account: '123456789012', alertEmail: 'alerts@example.com' };

describe('ArchiveStack', () => {
  it('archives positions and events into a private compressed S3 bucket', () => {
    const app = new App();
    const config = loadConfig((key) => context[key as keyof typeof context]);
    const data = new DataStack(app, 'Data', { config });
    const template = Template.fromStack(new ArchiveStack(app, 'Archive', { config, data }));
    template.resourceCountIs('AWS::Pipes::Pipe', 2);
    template.resourceCountIs('AWS::KinesisFirehose::DeliveryStream', 2);
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });
});
