import { App, AspectPriority, Aspects } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { CostGuardrails } from '../lib/aspects/cost-guardrails';
import { loadConfig } from '../lib/config';
import { FoundationStack } from '../lib/stacks/foundation-stack';

const BASE_CONTEXT = { env: 'dev', account: '123456789012', alertEmail: 'alerts@example.com' };

function synthFoundation(extraContext: Record<string, unknown> = {}) {
  const context: Record<string, unknown> = { ...BASE_CONTEXT, ...extraContext };
  const config = loadConfig((key) => context[key]);
  const app = new App();
  const stack = new FoundationStack(app, 'Foundation', {
    env: { account: config.account, region: config.region },
    config,
  });
  Aspects.of(app).add(new CostGuardrails(config.switches), { priority: AspectPriority.READONLY });
  return { stack, template: Template.fromStack(stack) };
}

describe('FoundationStack', () => {
  it('creates a monthly cost budget with forecast and actual email alerts', () => {
    const { template } = synthFoundation();
    template.resourceCountIs('AWS::Budgets::Budget', 1);
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: {
        BudgetName: 'trackify-dev-monthly',
        BudgetType: 'COST',
        TimeUnit: 'MONTHLY',
        BudgetLimit: { Amount: 10, Unit: 'USD' },
      },
      NotificationsWithSubscribers: [
        {
          Notification: Match.objectLike({ NotificationType: 'FORECASTED', Threshold: 80 }),
          Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'alerts@example.com' }],
        },
        {
          Notification: Match.objectLike({ NotificationType: 'ACTUAL', Threshold: 100 }),
          Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'alerts@example.com' }],
        },
      ],
    });
  });

  it('adds no anomaly detection resources by default', () => {
    const { template } = synthFoundation();
    template.resourceCountIs('AWS::CE::AnomalyMonitor', 0);
    template.resourceCountIs('AWS::CE::AnomalySubscription', 0);
  });

  it('creates a services monitor and a daily subscription when asked', () => {
    const { template } = synthFoundation({
      createAnomalyMonitor: 'true',
      anomalyThresholdUsd: '7',
    });
    template.hasResourceProperties('AWS::CE::AnomalyMonitor', {
      MonitorType: 'DIMENSIONAL',
      MonitorDimension: 'SERVICE',
    });
    template.hasResourceProperties('AWS::CE::AnomalySubscription', {
      Frequency: 'DAILY',
      MonitorArnList: [
        { 'Fn::GetAtt': [Match.stringLikeRegexp('ServicesAnomalyMonitor'), 'MonitorArn'] },
      ],
      Subscribers: [{ Type: 'EMAIL', Address: 'alerts@example.com' }],
      ThresholdExpression: Match.serializedJson({
        Dimensions: {
          Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
          MatchOptions: ['GREATER_THAN_OR_EQUAL'],
          Values: ['7'],
        },
      }),
    });
  });

  it('subscribes to an existing monitor without creating one', () => {
    const monitorArn = 'arn:aws:ce::123456789012:anomalymonitor/existing-default-monitor';
    const { template } = synthFoundation({ anomalyMonitorArn: monitorArn });
    template.resourceCountIs('AWS::CE::AnomalyMonitor', 0);
    template.hasResourceProperties('AWS::CE::AnomalySubscription', {
      MonitorArnList: [monitorArn],
    });
  });

  it('passes the cost guardrails', () => {
    const { stack } = synthFoundation({ createAnomalyMonitor: 'true' });
    expect(Annotations.fromStack(stack).findError('*', Match.anyValue())).toHaveLength(0);
    expect(
      Annotations.fromStack(stack).findWarning('*', Match.stringLikeRegexp('cost-guardrail')),
    ).toHaveLength(0);
  });
});
