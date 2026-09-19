import { Annotations, CfnResource, type IAspect } from 'aws-cdk-lib';
import { CfnGlobalTable, CfnTable } from 'aws-cdk-lib/aws-dynamodb';
import { CfnVPCEndpoint } from 'aws-cdk-lib/aws-ec2';
import { CfnLoadBalancer } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { CfnAlias, CfnVersion } from 'aws-cdk-lib/aws-lambda';
import { CfnLogGroup } from 'aws-cdk-lib/aws-logs';
import type { IConstruct } from 'constructs';
import type { ScaleSwitches } from '../config';

export type GuardrailSeverity = 'error' | 'warning';

export interface GuardrailRule {
  /** CloudFormation resource type, e.g. AWS::EC2::NatGateway. */
  resourceType: string;
  severity: GuardrailSeverity;
  reason: string;
  /** Narrows the rule to resources with a costly configuration. Defaults to every resource of the type. */
  appliesTo?: (resource: CfnResource) => boolean;
  /** Scale switch that makes this resource intentional. */
  allowedWhen?: (switches: ScaleSwitches) => boolean;
}

const ALWAYS_ON_COMPUTE = 'bills every hour even with zero traffic — use Lambda or Fargate';
const ALWAYS_ON_DATA = 'bills every hour even with zero traffic — use DynamoDB, S3 or Athena';

export const COST_GUARDRAIL_RULES: readonly GuardrailRule[] = [
  // Always-on resources that would break the low idle cost target.
  {
    resourceType: 'AWS::EC2::NatGateway',
    severity: 'error',
    reason: '~$33/month each with no traffic — run tasks in public subnets',
  },
  { resourceType: 'AWS::EC2::Instance', severity: 'error', reason: ALWAYS_ON_COMPUTE },
  {
    resourceType: 'AWS::AutoScaling::AutoScalingGroup',
    severity: 'error',
    reason: ALWAYS_ON_COMPUTE,
  },
  {
    resourceType: 'AWS::EKS::Cluster',
    severity: 'error',
    reason: '~$73/month control plane — use ECS on Fargate',
  },
  { resourceType: 'AWS::RDS::DBInstance', severity: 'error', reason: ALWAYS_ON_DATA },
  { resourceType: 'AWS::RDS::DBCluster', severity: 'error', reason: ALWAYS_ON_DATA },
  { resourceType: 'AWS::DocDB::DBCluster', severity: 'error', reason: ALWAYS_ON_DATA },
  { resourceType: 'AWS::Neptune::DBCluster', severity: 'error', reason: ALWAYS_ON_DATA },
  { resourceType: 'AWS::Redshift::Cluster', severity: 'error', reason: ALWAYS_ON_DATA },
  { resourceType: 'AWS::ElastiCache::CacheCluster', severity: 'error', reason: ALWAYS_ON_DATA },
  { resourceType: 'AWS::ElastiCache::ReplicationGroup', severity: 'error', reason: ALWAYS_ON_DATA },
  {
    resourceType: 'AWS::ElastiCache::ServerlessCache',
    severity: 'error',
    reason: 'has a minimum hourly charge — use DynamoDB',
  },
  { resourceType: 'AWS::OpenSearchService::Domain', severity: 'error', reason: ALWAYS_ON_DATA },
  { resourceType: 'AWS::Elasticsearch::Domain', severity: 'error', reason: ALWAYS_ON_DATA },
  {
    resourceType: 'AWS::OpenSearchServerless::Collection',
    severity: 'error',
    reason: 'has a minimum hourly OCU charge — use Athena',
  },
  { resourceType: 'AWS::MSK::Cluster', severity: 'error', reason: ALWAYS_ON_DATA },
  {
    resourceType: 'AWS::MSK::ServerlessCluster',
    severity: 'error',
    reason: 'has a per-cluster hourly charge — use SQS FIFO or Kinesis',
  },
  {
    resourceType: 'AWS::GlobalAccelerator::Accelerator',
    severity: 'error',
    reason: '~$18/month fixed fee — use DNS or the NLB switch',
  },
  {
    resourceType: 'AWS::EC2::VPCEndpoint',
    severity: 'error',
    reason: 'interface endpoints cost ~$7/month per AZ — gateway endpoints (DynamoDB, S3) are free',
    appliesTo: (resource) =>
      resource instanceof CfnVPCEndpoint && (resource.vpcEndpointType ?? 'Gateway') !== 'Gateway',
  },
  {
    resourceType: 'AWS::Lambda::Alias',
    severity: 'error',
    reason: 'provisioned concurrency bills around the clock — rely on normal scaling',
    appliesTo: (resource) =>
      resource instanceof CfnAlias && resource.provisionedConcurrencyConfig !== undefined,
  },
  {
    resourceType: 'AWS::Lambda::Version',
    severity: 'error',
    reason: 'provisioned concurrency bills around the clock — rely on normal scaling',
    appliesTo: (resource) =>
      resource instanceof CfnVersion && resource.provisionedConcurrencyConfig !== undefined,
  },
  {
    resourceType: 'AWS::Logs::LogGroup',
    severity: 'error',
    reason: 'log groups without a retention period grow cost forever — set retention',
    appliesTo: (resource) =>
      resource instanceof CfnLogGroup && resource.retentionInDays === undefined,
  },
  {
    resourceType: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
    severity: 'error',
    reason: 'Application Load Balancers bill hourly — use CloudFront + API Gateway',
    appliesTo: (resource) => resource instanceof CfnLoadBalancer && resource.type !== 'network',
  },

  // Allowed only when the matching scale switch is on.
  {
    resourceType: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
    severity: 'error',
    reason: 'a Network Load Balancer bills hourly — enable the gatewayNlb switch to allow it',
    appliesTo: (resource) => resource instanceof CfnLoadBalancer && resource.type === 'network',
    allowedWhen: (switches) => switches.gatewayNlb,
  },
  {
    resourceType: 'AWS::EC2::EIP',
    severity: 'error',
    reason: 'static public IPs bill hourly — only needed with the gatewayNlb switch',
    allowedWhen: (switches) => switches.gatewayNlb,
  },
  {
    resourceType: 'AWS::Kinesis::Stream',
    severity: 'error',
    reason:
      'Kinesis bills per shard-hour — the default backbone is SQS FIFO (set backbone=kinesis)',
    allowedWhen: (switches) => switches.backbone === 'kinesis',
  },
  {
    resourceType: 'AWS::DynamoDB::Table',
    severity: 'error',
    reason:
      'provisioned capacity bills hourly — use PAY_PER_REQUEST (or set dynamoCapacity=provisioned)',
    appliesTo: (resource) =>
      resource instanceof CfnTable && resource.billingMode !== 'PAY_PER_REQUEST',
    allowedWhen: (switches) => switches.dynamoCapacity === 'provisioned',
  },
  {
    resourceType: 'AWS::DynamoDB::GlobalTable',
    severity: 'error',
    reason:
      'provisioned capacity bills hourly — use PAY_PER_REQUEST (or set dynamoCapacity=provisioned)',
    appliesTo: (resource) =>
      resource instanceof CfnGlobalTable && resource.billingMode !== 'PAY_PER_REQUEST',
    allowedWhen: (switches) => switches.dynamoCapacity === 'provisioned',
  },

  // Small fixed costs: allowed, but should be a deliberate choice.
  {
    resourceType: 'AWS::SecretsManager::Secret',
    severity: 'warning',
    reason: '$0.40/secret/month — prefer SSM Parameter Store unless rotation is needed',
  },
  {
    resourceType: 'AWS::KMS::Key',
    severity: 'warning',
    reason: '$1/month per customer managed key — prefer AWS managed keys',
  },
  {
    resourceType: 'AWS::CloudWatch::Dashboard',
    severity: 'warning',
    reason: 'dashboards beyond the free 3 cost $3/month each',
  },
  {
    resourceType: 'AWS::Config::ConfigurationRecorder',
    severity: 'warning',
    reason: 'AWS Config bills continuously per recorded item — enable deliberately',
  },
  {
    resourceType: 'AWS::GuardDuty::Detector',
    severity: 'warning',
    reason: 'GuardDuty bills continuously after its trial — enable deliberately',
  },
  {
    resourceType: 'AWS::SecurityHub::Hub',
    severity: 'warning',
    reason: 'Security Hub bills continuously per check — enable deliberately',
  },
];

/**
 * Fails `cdk synth` when a resource would add always-on cost that the platform design avoids,
 * unless the matching scale switch is enabled. Small fixed costs produce warnings.
 */
export class CostGuardrails implements IAspect {
  constructor(
    private readonly switches: ScaleSwitches,
    private readonly rules: readonly GuardrailRule[] = COST_GUARDRAIL_RULES,
  ) {}

  visit(node: IConstruct): void {
    if (!CfnResource.isCfnResource(node)) return;

    for (const rule of this.rules) {
      if (rule.resourceType !== node.cfnResourceType) continue;
      if (rule.appliesTo && !rule.appliesTo(node)) continue;
      if (rule.allowedWhen?.(this.switches)) continue;

      const message = `[cost-guardrail] ${rule.resourceType}: ${rule.reason}`;
      if (rule.severity === 'error') {
        Annotations.of(node).addError(message);
      } else {
        Annotations.of(node).addWarningV2(`trackify:cost-guardrail:${rule.resourceType}`, message);
      }
    }
  }
}
