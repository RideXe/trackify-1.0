import { describe, expect, it } from 'vitest';
import { loadConfig } from '../lib/config';

const REQUIRED = { env: 'dev', account: '123456789012', alertEmail: 'alerts@example.com' };

function contextOf(values: Record<string, unknown>) {
  return (key: string) => values[key];
}

describe('loadConfig', () => {
  it('applies dev defaults: Mumbai, $10 budget, every scale switch off', () => {
    const config = loadConfig(contextOf(REQUIRED));
    expect(config).toEqual({
      envName: 'dev',
      account: '123456789012',
      region: 'ap-south-1',
      alertEmail: 'alerts@example.com',
      monthlyBudgetUsd: 10,
      enableGateway: false,
      allowLegacyPhoneIngest: true,
      dashboardUrl: 'http://localhost:5173',
      cognitoDomainPrefix: 'trackify-123456789012-dev',
      anomalyAlerts: { mode: 'none' },
      switches: {
        gatewayNlb: false,
        multiAz: false,
        backbone: 'sqs-fifo',
        dynamoCapacity: 'on-demand',
      },
    });
  });

  it('applies prod defaults', () => {
    const config = loadConfig(
      contextOf({ ...REQUIRED, env: 'prod', dashboardUrl: 'https://fleet.example.com' }),
    );
    expect(config.monthlyBudgetUsd).toBe(50);
    expect(config.switches.gatewayNlb).toBe(false);
    expect(config.allowLegacyPhoneIngest).toBe(false);
  });

  it('requires the reliable NLB path when the raw TCP gateway is enabled', () => {
    expect(() => loadConfig(contextOf({ ...REQUIRED, enableGateway: true }))).toThrowError(
      /enableGateway requires gatewayNlb=true/,
    );
    expect(
      loadConfig(contextOf({ ...REQUIRED, enableGateway: true, gatewayNlb: true })).enableGateway,
    ).toBe(true);
  });

  it('does not permit legacy unauthenticated phone ingestion in prod', () => {
    expect(() =>
      loadConfig(
        contextOf({
          ...REQUIRED,
          env: 'prod',
          dashboardUrl: 'https://fleet.example.com',
          allowLegacyPhoneIngest: true,
        }),
      ),
    ).toThrowError(/cannot be enabled in prod/);
  });

  it('requires an HTTPS dashboard callback in prod', () => {
    expect(() => loadConfig(contextOf({ ...REQUIRED, env: 'prod' }))).toThrowError(
      /must use https/,
    );
  });

  it('parses string values passed with -c on the command line', () => {
    const config = loadConfig(
      contextOf({
        ...REQUIRED,
        region: 'eu-west-1',
        monthlyBudgetUsd: '25',
        gatewayNlb: 'true',
        multiAz: 'false',
        backbone: 'kinesis',
        dynamoCapacity: 'provisioned',
      }),
    );
    expect(config.region).toBe('eu-west-1');
    expect(config.monthlyBudgetUsd).toBe(25);
    expect(config.switches).toEqual({
      gatewayNlb: true,
      multiAz: false,
      backbone: 'kinesis',
      dynamoCapacity: 'provisioned',
    });
  });

  it('accepts typed values from cdk.json', () => {
    const config = loadConfig(contextOf({ ...REQUIRED, monthlyBudgetUsd: 15, gatewayNlb: true }));
    expect(config.monthlyBudgetUsd).toBe(15);
    expect(config.switches.gatewayNlb).toBe(true);
  });

  it('reports every invalid value in a single error', () => {
    expect(() =>
      loadConfig(
        contextOf({
          env: 'staging',
          account: '1234',
          alertEmail: 'not-an-email',
          monthlyBudgetUsd: '-5',
          gatewayNlb: 'yes',
          backbone: 'kafka',
        }),
      ),
    ).toThrowError(
      /env must be one of[\s\S]*account must be[\s\S]*alertEmail must be[\s\S]*monthlyBudgetUsd[\s\S]*gatewayNlb[\s\S]*backbone/,
    );
  });

  it('requires account and alert email', () => {
    expect(() => loadConfig(contextOf({ env: 'dev' }))).toThrowError(/account[\s\S]*alertEmail/);
  });

  describe('anomaly alerts', () => {
    it('creates a monitor only when asked', () => {
      const config = loadConfig(contextOf({ ...REQUIRED, createAnomalyMonitor: 'true' }));
      expect(config.anomalyAlerts).toEqual({ mode: 'create', thresholdUsd: 5 });
    });

    it('subscribes to an existing monitor', () => {
      const monitorArn =
        'arn:aws:ce::123456789012:anomalymonitor/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';
      const config = loadConfig(
        contextOf({ ...REQUIRED, anomalyMonitorArn: monitorArn, anomalyThresholdUsd: '20' }),
      );
      expect(config.anomalyAlerts).toEqual({ mode: 'subscribe', monitorArn, thresholdUsd: 20 });
    });

    it('rejects asking for both a new and an existing monitor', () => {
      expect(() =>
        loadConfig(
          contextOf({
            ...REQUIRED,
            createAnomalyMonitor: true,
            anomalyMonitorArn: 'arn:aws:ce::123456789012:anomalymonitor/abc',
          }),
        ),
      ).toThrowError(/not both/);
    });

    it('rejects a malformed monitor ARN', () => {
      expect(() =>
        loadConfig(contextOf({ ...REQUIRED, anomalyMonitorArn: 'arn:aws:sns:ap-south-1:1:topic' })),
      ).toThrowError(/anomalyMonitorArn/);
    });
  });
});
