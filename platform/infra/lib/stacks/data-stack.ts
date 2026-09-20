import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  StreamViewType,
  Table,
} from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../config';

export interface DataStackProps extends StackProps {
  config: EnvConfig;
}

export class DataStack extends Stack {
  readonly core: Table;
  readonly positions: Table;
  readonly deviceState: Table;
  readonly events: Table;
  readonly trips: Table;
  readonly dailyStats: Table;
  readonly commands: Table;
  readonly gatewaySessions: Table;
  readonly onboarding: Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const removalPolicy =
      props.config.envName === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    this.core = new Table(this, 'Core', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy,
    });
    this.core.addGlobalSecondaryIndex({
      indexName: 'byUniqueId',
      partitionKey: { name: 'lookupPk', type: AttributeType.STRING },
      sortKey: { name: 'lookupSk', type: AttributeType.STRING },
      projectionType: ProjectionType.KEYS_ONLY,
    });
    this.core.addGlobalSecondaryIndex({
      indexName: 'byCognitoSub',
      partitionKey: { name: 'cognitoPk', type: AttributeType.STRING },
      sortKey: { name: 'cognitoSk', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
    this.positions = new Table(this, 'Positions', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      timeToLiveAttribute: 'expiresAt',
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_IMAGE,
      removalPolicy,
    });
    this.deviceState = new Table(this, 'DeviceState', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: props.config.envName === 'prod',
      },
      removalPolicy,
    });
    this.deviceState.addGlobalSecondaryIndex({
      indexName: 'byTenant',
      partitionKey: { name: 'tenantPk', type: AttributeType.STRING },
      sortKey: { name: 'tenantSk', type: AttributeType.STRING },
    });
    this.deviceState.addGlobalSecondaryIndex({
      indexName: 'byStaleness',
      partitionKey: { name: 'stalePk', type: AttributeType.STRING },
      sortKey: { name: 'staleSk', type: AttributeType.NUMBER },
      projectionType: ProjectionType.ALL,
    });
    this.events = timeSeriesTable(this, 'Events', removalPolicy, 'expiresAt', true);
    this.events.addGlobalSecondaryIndex({
      indexName: 'byTenantMonth',
      partitionKey: { name: 'tenantMonthPk', type: AttributeType.STRING },
      sortKey: { name: 'tenantMonthSk', type: AttributeType.STRING },
    });
    this.trips = timeSeriesTable(this, 'Trips', removalPolicy, 'expiresAt');
    this.dailyStats = timeSeriesTable(this, 'DailyStats', removalPolicy, 'expiresAt');
    this.commands = timeSeriesTable(this, 'Commands', removalPolicy, 'expiresAt');
    this.commands.addGlobalSecondaryIndex({
      indexName: 'byStatus',
      partitionKey: { name: 'statusPk', type: AttributeType.STRING },
      sortKey: { name: 'statusSk', type: AttributeType.STRING },
    });
    this.gatewaySessions = new Table(this, 'GatewaySessions', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      timeToLiveAttribute: 'expiresAt',
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });
    this.onboarding = new Table(this, 'Onboarding', {
      partitionKey: { name: 'codeHash', type: AttributeType.STRING },
      timeToLiveAttribute: 'expiresAt',
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });
    this.onboarding.addGlobalSecondaryIndex({
      indexName: 'byDevice',
      partitionKey: { name: 'devicePk', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.NUMBER },
      projectionType: ProjectionType.ALL,
    });
    this.onboarding.addGlobalSecondaryIndex({
      indexName: 'byCredential',
      partitionKey: { name: 'credentialHash', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }
}

function timeSeriesTable(
  scope: Construct,
  id: string,
  removalPolicy: RemovalPolicy,
  ttlAttribute: string,
  stream = false,
) {
  return new Table(scope, id, {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
    sortKey: { name: 'sk', type: AttributeType.STRING },
    timeToLiveAttribute: ttlAttribute,
    billingMode: BillingMode.PAY_PER_REQUEST,
    stream: stream ? StreamViewType.NEW_IMAGE : undefined,
    removalPolicy,
  });
}
