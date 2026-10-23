import { Stack, type StackProps } from 'aws-cdk-lib';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../config';

export interface AlertsStackProps extends StackProps {
  config: EnvConfig;
}

/**
 * One email topic for every operational alarm, so the address is confirmed once. AWS emails a
 * confirmation link to alertEmail on first deploy; no alarm email arrives until it is clicked.
 */
export class AlertsStack extends Stack {
  readonly topic: Topic;

  constructor(scope: Construct, id: string, props: AlertsStackProps) {
    super(scope, id, props);
    this.topic = new Topic(this, 'OperationalAlarms', {
      displayName: `Trackify ${props.config.envName} alarms`,
    });
    this.topic.addSubscription(new EmailSubscription(props.config.alertEmail));
  }
}
