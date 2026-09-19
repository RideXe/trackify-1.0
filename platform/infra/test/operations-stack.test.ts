import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { loadConfig } from '../lib/config';
import { DataStack } from '../lib/stacks/data-stack';
import { OperationsStack } from '../lib/stacks/operations-stack';

const context = { env: 'dev', account: '123456789012', alertEmail: 'alerts@example.com' };

describe('OperationsStack', () => {
  it('runs the offline sweep once per minute with no always-on compute', () => {
    const app = new App();
    const config = loadConfig((key) => context[key as keyof typeof context]);
    const data = new DataStack(app, 'Data', { config });
    const stack = new OperationsStack(app, 'Operations', {
      config,
      data,
      platformPath: new URL('../..', import.meta.url).pathname,
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 minute)',
      State: 'ENABLED',
    });
  });
});
