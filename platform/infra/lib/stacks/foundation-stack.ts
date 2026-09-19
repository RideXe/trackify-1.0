import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { CfnAnomalyMonitor, CfnAnomalySubscription } from 'aws-cdk-lib/aws-ce';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../config';

export interface FoundationStackProps extends StackProps {
  config: EnvConfig;
}

/**
 * Account-level cost controls. Everything here is free: one budget and (optionally) anomaly alerts.
 */
export class FoundationStack extends Stack {
  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);
    const { config } = props;

    const budget = new CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `trackify-${config.envName}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: config.monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        budgetAlert('FORECASTED', 80, config.alertEmail),
        budgetAlert('ACTUAL', 100, config.alertEmail),
      ],
    });
    new CfnOutput(this, 'BudgetName', { value: budget.ref });

    const alerts = config.anomalyAlerts;
    if (alerts.mode === 'none') return;

    let monitorArn: string;
    if (alerts.mode === 'create') {
      const monitor = new CfnAnomalyMonitor(this, 'ServicesAnomalyMonitor', {
        monitorName: `trackify-${config.envName}-services`,
        monitorType: 'DIMENSIONAL',
        monitorDimension: 'SERVICE',
      });
      monitorArn = monitor.attrMonitorArn;
    } else {
      monitorArn = alerts.monitorArn;
    }

    new CfnAnomalySubscription(this, 'AnomalyAlerts', {
      subscriptionName: `trackify-${config.envName}-anomaly-alerts`,
      frequency: 'DAILY',
      monitorArnList: [monitorArn],
      subscribers: [{ type: 'EMAIL', address: config.alertEmail }],
      thresholdExpression: JSON.stringify({
        Dimensions: {
          Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
          MatchOptions: ['GREATER_THAN_OR_EQUAL'],
          Values: [String(alerts.thresholdUsd)],
        },
      }),
    });
  }
}

function budgetAlert(
  notificationType: 'ACTUAL' | 'FORECASTED',
  thresholdPercent: number,
  email: string,
): CfnBudget.NotificationWithSubscribersProperty {
  return {
    notification: {
      notificationType,
      comparisonOperator: 'GREATER_THAN',
      threshold: thresholdPercent,
      thresholdType: 'PERCENTAGE',
    },
    subscribers: [{ subscriptionType: 'EMAIL', address: email }],
  };
}
