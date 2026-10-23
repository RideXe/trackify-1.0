import { Duration, Stack } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  TreatMissingData,
  type IMetric,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

/** Lambda failures within five minutes before anyone is emailed; single retries stay quiet. */
const ERRORS_THRESHOLD = 3;

/** Emails the topic when the alarm fires and again when it clears. */
function alarm(
  scope: Construct,
  id: string,
  topic: ITopic,
  props: {
    description: string;
    metric: IMetric;
    threshold: number;
    evaluationPeriods?: number;
    comparisonOperator?: ComparisonOperator;
  },
) {
  const created = new Alarm(scope, id, {
    alarmName: `${Stack.of(scope).stackName}-${id}`,
    alarmDescription: props.description,
    metric: props.metric,
    threshold: props.threshold,
    evaluationPeriods: props.evaluationPeriods ?? 1,
    comparisonOperator:
      props.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    // No traffic means nothing failed.
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
  const action = new SnsAction(topic);
  created.addAlarmAction(action);
  created.addOkAction(action);
  return created;
}

export function alarmOnErrors(scope: Construct, fn: IFunction, topic: ITopic) {
  return alarm(scope, `${fn.node.id}Errors`, topic, {
    description: `${fn.node.id} failed ${ERRORS_THRESHOLD}+ times in 5 minutes. Check its log group.`,
    metric: fn.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
    threshold: ERRORS_THRESHOLD,
  });
}

/** Anything in a dead-letter queue is a message that failed every retry. */
export function alarmOnDeadLetters(scope: Construct, id: string, queue: IQueue, topic: ITopic) {
  return alarm(scope, id, topic, {
    description: 'Messages failed every retry and are waiting in the dead-letter queue.',
    metric: queue.metricApproximateNumberOfMessagesVisible({
      period: Duration.minutes(5),
      statistic: 'Maximum',
    }),
    threshold: 1,
  });
}

/** Fires when the oldest message has waited longer than maxAge for five minutes in a row. */
export function alarmOnBacklog(
  scope: Construct,
  id: string,
  queue: IQueue,
  maxAge: Duration,
  topic: ITopic,
) {
  return alarm(scope, id, topic, {
    description: `Processing is behind: messages have waited over ${maxAge.toSeconds()} s for 5 minutes.`,
    metric: queue.metricApproximateAgeOfOldestMessage({
      period: Duration.minutes(1),
      statistic: 'Maximum',
    }),
    threshold: maxAge.toSeconds(),
    evaluationPeriods: 5,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
  });
}

export function alarmOnServerErrors(scope: Construct, id: string, metric: IMetric, topic: ITopic) {
  return alarm(scope, id, topic, {
    description: 'The API returned 5+ server errors (5xx) in 5 minutes.',
    metric,
    threshold: 5,
  });
}
