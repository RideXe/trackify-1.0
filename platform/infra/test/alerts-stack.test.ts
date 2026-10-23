import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { loadConfig } from '../lib/config';
import { AlertsStack } from '../lib/stacks/alerts-stack';
import { DataStack } from '../lib/stacks/data-stack';
import { IngestStack } from '../lib/stacks/ingest-stack';
import { OperationsStack } from '../lib/stacks/operations-stack';

const context = { env: 'dev', account: '123456789012', alertEmail: 'alerts@example.com' };
const platformPath = new URL('../..', import.meta.url).pathname;

function synth(withAlarms: boolean) {
  const app = new App();
  const config = loadConfig((key) => context[key as keyof typeof context]);
  const alerts = new AlertsStack(app, 'Alerts', { config });
  const alarmTopic = withAlarms ? alerts.topic : undefined;
  const data = new DataStack(app, 'Data', { config });
  const ingest = new IngestStack(app, 'Ingest', { config, data, platformPath, alarmTopic });
  const operations = new OperationsStack(app, 'Operations', {
    config,
    data,
    platformPath,
    alarmTopic,
  });
  return {
    alerts: Template.fromStack(alerts),
    ingest: Template.fromStack(ingest),
    operations: Template.fromStack(operations),
  };
}

describe('operational alarms', () => {
  it('emails the alert address from a single topic', () => {
    synth(true).alerts.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'alerts@example.com',
    });
  });

  it('alarms on processing errors, dead letters and backlog, notifying on fire and clear', () => {
    const { ingest, operations } = synth(true);
    ingest.resourceCountIs('AWS::CloudWatch::Alarm', 3);
    ingest.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Threshold: 1,
      TreatMissingData: 'notBreaching',
      AlarmActions: [Match.anyValue()],
      OKActions: [Match.anyValue()],
    });
    ingest.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'ApproximateAgeOfOldestMessage',
      Threshold: 60,
      EvaluationPeriods: 5,
    });
    operations.resourceCountIs('AWS::CloudWatch::Alarm', 1);
  });

  it('creates no alarms without a topic', () => {
    synth(false).ingest.resourceCountIs('AWS::CloudWatch::Alarm', 0);
  });
});
