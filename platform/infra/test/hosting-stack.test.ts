import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { loadConfig } from '../lib/config';
import { HostingStack } from '../lib/stacks/hosting-stack';

const context = { env: 'dev', account: '123456789012', alertEmail: 'alerts@example.com' };

describe('HostingStack', () => {
  it('keeps dashboard files private behind an HTTPS CloudFront distribution', () => {
    const app = new App();
    const config = loadConfig((key) => context[key as keyof typeof context]);
    const template = Template.fromStack(new HostingStack(app, 'Hosting', { config }));
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: { DefaultRootObject: 'index.html', Enabled: true },
    });
  });
});
