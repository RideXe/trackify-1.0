import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { Vpc, Peer, Port, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerImage,
  CpuArchitecture,
  FargateService,
  FargateTaskDefinition,
  LogDrivers,
  OperatingSystemFamily,
} from 'aws-cdk-lib/aws-ecs';
import {
  NetworkLoadBalancer,
  NetworkTargetGroup,
  Protocol,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { trackerProtocols } from '@trackify/protocols/ports';
import type { EnvConfig } from '../config';
import type { DataStack } from './data-stack';
import type { IngestStack } from './ingest-stack';

export interface GatewayStackProps extends StackProps {
  config: EnvConfig;
  data: DataStack;
  ingest: IngestStack;
  platformPath: string;
}

export class GatewayStack extends Stack {
  constructor(scope: Construct, id: string, props: GatewayStackProps) {
    super(scope, id, props);
    const vpc = new Vpc(this, 'Vpc', {
      maxAzs: props.config.switches.multiAz ? 2 : 1,
      natGateways: 0,
    });
    const cluster = new Cluster(this, 'Cluster', { vpc });
    const task = new FargateTaskDefinition(this, 'Task', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });
    const logs = new LogGroup(this, 'GatewayLogs', { retention: RetentionDays.ONE_WEEK });
    const container = task.addContainer('Gateway', {
      image: ContainerImage.fromAsset(props.platformPath, {
        file: 'apps/tracker-gateway/Dockerfile',
      }),
      environment: {
        CORE_TABLE: props.data.core.tableName,
        INGEST_QUEUE_URL: props.ingest.queue.queueUrl,
        COMMANDS_TABLE: props.data.commands.tableName,
        EVENTS_TABLE: props.data.events.tableName,
      },
      logging: LogDrivers.awsLogs({ streamPrefix: 'gateway', logGroup: logs }),
    });
    const protocols = Object.entries(trackerProtocols);
    container.addPortMappings(...protocols.map(([, { port }]) => ({ containerPort: port })));
    props.data.core.grantReadData(task.taskRole);
    props.ingest.queue.grantSendMessages(task.taskRole);
    // Command delivery: read waiting commands, claim and complete them, record replies as events.
    props.data.commands.grantReadWriteData(task.taskRole);
    props.data.events.grantWriteData(task.taskRole);
    const loadBalancerSecurityGroup = new SecurityGroup(this, 'LoadBalancerSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });
    for (const [, { port, label }] of protocols)
      loadBalancerSecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(port), `${label} trackers`);
    const taskSecurityGroup = new SecurityGroup(this, 'GatewayTaskSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });
    for (const [, { port, label }] of protocols)
      taskSecurityGroup.addIngressRule(
        loadBalancerSecurityGroup,
        Port.tcp(port),
        `${label} from NLB`,
      );
    const service = new FargateService(this, 'Service', {
      cluster,
      taskDefinition: task,
      desiredCount: 1,
      assignPublicIp: true,
      securityGroups: [taskSecurityGroup],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });
    const loadBalancer = new NetworkLoadBalancer(this, 'GatewayNlb', {
      vpc,
      internetFacing: true,
      securityGroups: [loadBalancerSecurityGroup],
    });
    for (const [, { port }] of protocols) {
      const target = new NetworkTargetGroup(this, `Target${port}`, {
        vpc,
        port,
        protocol: Protocol.TCP,
        targets: [service],
        deregistrationDelay: Duration.seconds(30),
      });
      loadBalancer.addListener(`Listener${port}`, {
        port,
        protocol: Protocol.TCP,
        defaultTargetGroups: [target],
      });
    }
    const scaling = service.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 20 });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: Duration.minutes(10),
    });
    new CfnOutput(this, 'GatewayHostname', { value: loadBalancer.loadBalancerDnsName });
  }
}
