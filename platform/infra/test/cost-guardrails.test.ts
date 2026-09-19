import { App, AspectPriority, Aspects, Stack } from 'aws-cdk-lib';
import { Annotations, Match } from 'aws-cdk-lib/assertions';
import { CfnTable } from 'aws-cdk-lib/aws-dynamodb';
import { CfnNatGateway, CfnVPCEndpoint } from 'aws-cdk-lib/aws-ec2';
import { CfnLoadBalancer } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { CfnStream } from 'aws-cdk-lib/aws-kinesis';
import { CfnAlias } from 'aws-cdk-lib/aws-lambda';
import { CfnLogGroup } from 'aws-cdk-lib/aws-logs';
import { CfnSecret } from 'aws-cdk-lib/aws-secretsmanager';
import { describe, expect, it } from 'vitest';
import { CostGuardrails } from '../lib/aspects/cost-guardrails';
import type { ScaleSwitches } from '../lib/config';

const ALL_OFF: ScaleSwitches = {
  gatewayNlb: false,
  multiAz: false,
  backbone: 'sqs-fifo',
  dynamoCapacity: 'on-demand',
};

function guardrailFindings(build: (stack: Stack) => void, switches: Partial<ScaleSwitches> = {}) {
  const app = new App();
  const stack = new Stack(app, 'Test');
  build(stack);
  Aspects.of(app).add(new CostGuardrails({ ...ALL_OFF, ...switches }), {
    priority: AspectPriority.READONLY,
  });
  const annotations = Annotations.fromStack(stack);
  const guardrail = Match.stringLikeRegexp('cost-guardrail');
  return {
    errors: annotations.findError('*', guardrail),
    warnings: annotations.findWarning('*', guardrail),
  };
}

const pk = {
  keySchema: [{ attributeName: 'pk', keyType: 'HASH' }],
  attributeDefinitions: [{ attributeName: 'pk', attributeType: 'S' }],
};

describe('CostGuardrails', () => {
  it('blocks NAT Gateways', () => {
    const { errors } = guardrailFindings((stack) => {
      new CfnNatGateway(stack, 'Nat', { subnetId: 'subnet-123' });
    });
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors[0]?.entry.data)).toContain('AWS::EC2::NatGateway');
  });

  it('blocks interface VPC endpoints but allows free gateway endpoints', () => {
    const { errors } = guardrailFindings((stack) => {
      new CfnVPCEndpoint(stack, 'Interface', {
        vpcId: 'vpc-1',
        serviceName: 'com.amazonaws.ap-south-1.sqs',
        vpcEndpointType: 'Interface',
      });
      new CfnVPCEndpoint(stack, 'Gateway', {
        vpcId: 'vpc-1',
        serviceName: 'com.amazonaws.ap-south-1.dynamodb',
      });
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.id).toContain('Interface');
  });

  it('blocks Kinesis unless the kinesis backbone is selected', () => {
    const build = (stack: Stack) => {
      new CfnStream(stack, 'Stream', { shardCount: 1 });
    };
    expect(guardrailFindings(build).errors).toHaveLength(1);
    expect(guardrailFindings(build, { backbone: 'kinesis' }).errors).toHaveLength(0);
  });

  it('blocks a Network Load Balancer unless gatewayNlb is on, and always blocks ALBs', () => {
    const build = (stack: Stack) => {
      new CfnLoadBalancer(stack, 'Nlb', { type: 'network' });
      new CfnLoadBalancer(stack, 'Alb', { type: 'application' });
    };
    const off = guardrailFindings(build);
    expect(off.errors.map((e) => e.id).sort()).toEqual(['/Test/Alb', '/Test/Nlb']);

    const on = guardrailFindings(build, { gatewayNlb: true });
    expect(on.errors.map((e) => e.id)).toEqual(['/Test/Alb']);
  });

  it('requires a retention period on log groups', () => {
    const { errors } = guardrailFindings((stack) => {
      new CfnLogGroup(stack, 'Forever', {});
      new CfnLogGroup(stack, 'TwoWeeks', { retentionInDays: 14 });
    });
    expect(errors.map((e) => e.id)).toEqual(['/Test/Forever']);
  });

  it('blocks Lambda provisioned concurrency', () => {
    const { errors } = guardrailFindings((stack) => {
      new CfnAlias(stack, 'Warm', {
        functionName: 'fn',
        functionVersion: '1',
        name: 'live',
        provisionedConcurrencyConfig: { provisionedConcurrentExecutions: 1 },
      });
      new CfnAlias(stack, 'Normal', { functionName: 'fn', functionVersion: '1', name: 'next' });
    });
    expect(errors.map((e) => e.id)).toEqual(['/Test/Warm']);
  });

  it('requires on-demand DynamoDB tables unless provisioned capacity is switched on', () => {
    const build = (stack: Stack) => {
      new CfnTable(stack, 'Provisioned', {
        ...pk,
        provisionedThroughput: { readCapacityUnits: 5, writeCapacityUnits: 5 },
      });
      new CfnTable(stack, 'OnDemand', { ...pk, billingMode: 'PAY_PER_REQUEST' });
    };
    expect(guardrailFindings(build).errors.map((e) => e.id)).toEqual(['/Test/Provisioned']);
    expect(guardrailFindings(build, { dynamoCapacity: 'provisioned' }).errors).toHaveLength(0);
  });

  it('only warns about small fixed costs', () => {
    const findings = guardrailFindings((stack) => {
      new CfnSecret(stack, 'Secret', {});
    });
    expect(findings.errors).toHaveLength(0);
    expect(findings.warnings).toHaveLength(1);
  });
});
