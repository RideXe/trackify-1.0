export const ENV_NAMES = ['dev', 'prod'] as const;
export type EnvName = (typeof ENV_NAMES)[number];

export const BACKBONES = ['sqs-fifo', 'kinesis'] as const;
export type Backbone = (typeof BACKBONES)[number];

export const DYNAMO_CAPACITY_MODES = ['on-demand', 'provisioned'] as const;
export type DynamoCapacity = (typeof DYNAMO_CAPACITY_MODES)[number];

/**
 * One-time scale switches (docs/cost-model.md). Each is a config change, never an app rewrite,
 * and each adds idle cost — so all start off.
 */
export interface ScaleSwitches {
  /** Tracker gateway behind a Network Load Balancer with static IPs (+~$20/month idle). */
  gatewayNlb: boolean;
  /** Gateway in a second Availability Zone (+~$18/month idle). */
  multiAz: boolean;
  /** Ingest backbone. Kinesis is cheaper per message from ~5,000 cars (+~$11/month idle). */
  backbone: Backbone;
  /** DynamoDB capacity. Provisioned + autoscaling roughly halves write cost once traffic is steady. */
  dynamoCapacity: DynamoCapacity;
}

/**
 * Cost Anomaly Detection allows only one AWS-services monitor per account, and AWS may already have
 * created one — so creating a monitor is opt-in, and alerts can attach to an existing monitor instead.
 */
export type AnomalyAlerts =
  | { mode: 'none' }
  | { mode: 'create'; thresholdUsd: number }
  | { mode: 'subscribe'; monitorArn: string; thresholdUsd: number };

export type SsoProvider =
  | { kind: 'oidc'; name: string; issuerUrl: string; clientId: string; clientSecretName: string }
  | { kind: 'google'; clientId: string; clientSecretName: string };

export interface EnvConfig {
  envName: EnvName;
  account: string;
  region: string;
  alertEmail: string;
  monthlyBudgetUsd: number;
  /** Raw TCP gateway is an explicit paid deployment; disabled in an empty environment. */
  enableGateway: boolean;
  /** Temporary phone compatibility endpoint. Never enabled by default in production. */
  allowLegacyPhoneIngest: boolean;
  /** Cold archive depends on account-level Firehose activation and is opt-in. */
  enableArchive: boolean;
  /** Browser origin used by Cognito callbacks and API CORS. */
  dashboardUrl: string;
  /** Globally unique prefix for the Cognito managed-login domain. */
  cognitoDomainPrefix: string;
  /** From-address for alert and report emails. Unset leaves the email channel off. */
  emailSender?: string;
  /** Street addresses for trips and alerts via Amazon Location; billed per lookup, so opt-in. */
  geocoding: boolean;
  /** Single sign-on providers. Client secrets stay in Secrets Manager; only their names are here. */
  sso: SsoProvider[];
  anomalyAlerts: AnomalyAlerts;
  switches: ScaleSwitches;
}

const DEFAULT_REGION = 'ap-south-1';
const DEFAULT_ANOMALY_THRESHOLD_USD = 5;

const ENV_DEFAULTS: Record<EnvName, { monthlyBudgetUsd: number; switches: ScaleSwitches }> = {
  dev: {
    monthlyBudgetUsd: 10,
    switches: {
      gatewayNlb: false,
      multiAz: false,
      backbone: 'sqs-fifo',
      dynamoCapacity: 'on-demand',
    },
  },
  prod: {
    monthlyBudgetUsd: 50,
    switches: {
      gatewayNlb: false,
      multiAz: false,
      backbone: 'sqs-fifo',
      dynamoCapacity: 'on-demand',
    },
  },
};

export type ContextReader = (key: string) => unknown;

/**
 * Builds the environment config from CDK context (`-c key=value` or cdk.json).
 * Every problem is reported in one error so a broken deploy command needs only one fix.
 */
export function loadConfig(readContext: ContextReader): EnvConfig {
  const errors: string[] = [];
  const read = (key: string): unknown => {
    const value = readContext(key);
    return value === '' ? undefined : value;
  };

  const envName = read('env');
  if (!isOneOf(envName, ENV_NAMES)) {
    errors.push(`env must be one of ${ENV_NAMES.join(', ')} (got ${describe(envName)})`);
  }
  const defaults = ENV_DEFAULTS[isOneOf(envName, ENV_NAMES) ? envName : 'dev'];

  const account = read('account');
  if (typeof account !== 'string' || !/^\d{12}$/.test(account)) {
    errors.push(`account must be a 12-digit AWS account id (got ${describe(account)})`);
  }

  const region = read('region') ?? DEFAULT_REGION;
  if (typeof region !== 'string' || !/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) {
    errors.push(`region must be an AWS region like ap-south-1 (got ${describe(region)})`);
  }

  const alertEmail = read('alertEmail');
  if (typeof alertEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertEmail)) {
    errors.push(`alertEmail must be an email address (got ${describe(alertEmail)})`);
  }

  const monthlyBudgetUsd = parseNumber(read('monthlyBudgetUsd'), defaults.monthlyBudgetUsd);
  if (monthlyBudgetUsd === undefined || monthlyBudgetUsd <= 0) {
    errors.push('monthlyBudgetUsd must be a positive number');
  }

  const emailSender = read('emailSender');
  if (
    emailSender !== undefined &&
    (typeof emailSender !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailSender))
  ) {
    errors.push(`emailSender must be an email address (got ${describe(emailSender)})`);
  }

  const anomalyAlerts = readAnomalyAlerts(read, errors);
  const switches = readSwitches(read, defaults.switches, errors);
  const enableGateway = parseBoolean(read('enableGateway'), false);
  const allowLegacyPhoneIngest = parseBoolean(read('allowLegacyPhoneIngest'), false);
  const enableArchive = parseBoolean(read('enableArchive'), false);
  const geocoding = parseBoolean(read('geocoding'), false);
  const sso = readSso(read, errors);
  if (geocoding === undefined) errors.push('geocoding must be true or false');
  const dashboardUrl = read('dashboardUrl') ?? 'http://localhost:5173';
  const cognitoDomainPrefix =
    read('cognitoDomainPrefix') ?? `trackify-${String(account)}-${String(envName)}`;
  if (enableGateway === undefined) errors.push('enableGateway must be true or false');
  if (allowLegacyPhoneIngest === undefined)
    errors.push('allowLegacyPhoneIngest must be true or false');
  if (enableArchive === undefined) errors.push('enableArchive must be true or false');
  if (envName === 'prod' && allowLegacyPhoneIngest) {
    errors.push(
      'allowLegacyPhoneIngest cannot be enabled in prod; phase 2 device authentication is required',
    );
  }
  if (typeof dashboardUrl !== 'string' || !/^https?:\/\/[^/]+(?:\/.*)?$/.test(dashboardUrl)) {
    errors.push('dashboardUrl must be an absolute http or https URL');
  }
  if (
    envName === 'prod' &&
    typeof dashboardUrl === 'string' &&
    !dashboardUrl.startsWith('https://')
  ) {
    errors.push('dashboardUrl must use https in prod');
  }
  if (
    typeof cognitoDomainPrefix !== 'string' ||
    !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(cognitoDomainPrefix)
  ) {
    errors.push('cognitoDomainPrefix must be 3-63 lowercase letters, numbers, or hyphens');
  }
  if (enableGateway && !switches.gatewayNlb) {
    errors.push(
      'enableGateway requires gatewayNlb=true until the DNS pilot controller is implemented and tested',
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid Trackify config:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    envName: envName as EnvName,
    account: account as string,
    region: region as string,
    alertEmail: alertEmail as string,
    monthlyBudgetUsd: monthlyBudgetUsd as number,
    enableGateway: enableGateway ?? false,
    allowLegacyPhoneIngest: allowLegacyPhoneIngest ?? false,
    enableArchive: enableArchive ?? false,
    dashboardUrl: dashboardUrl as string,
    cognitoDomainPrefix: cognitoDomainPrefix as string,
    emailSender: emailSender as string | undefined,
    geocoding: geocoding ?? false,
    sso,
    anomalyAlerts,
    switches,
  };
}

/**
 * OIDC: oidcName, oidcIssuerUrl, oidcClientId, oidcClientSecretName (all four, or none).
 * Google: googleClientId and googleClientSecretName.
 */
function readSso(read: ContextReader, errors: string[]): SsoProvider[] {
  const providers: SsoProvider[] = [];
  const oidc = ['oidcName', 'oidcIssuerUrl', 'oidcClientId', 'oidcClientSecretName'].map(read);
  if (oidc.some((value) => value !== undefined)) {
    const [name, issuerUrl, clientId, clientSecretName] = oidc;
    if (oidc.some((value) => typeof value !== 'string'))
      errors.push(
        'single sign-on needs oidcName, oidcIssuerUrl, oidcClientId and oidcClientSecretName',
      );
    else if (!/^https:\/\/\S+$/.test(issuerUrl as string))
      errors.push('oidcIssuerUrl must be an https URL');
    else if (!/^[A-Za-z0-9 ]{1,32}$/.test(name as string))
      errors.push('oidcName must be letters, digits and spaces, up to 32 characters');
    else
      providers.push({
        kind: 'oidc',
        name: name as string,
        issuerUrl: issuerUrl as string,
        clientId: clientId as string,
        clientSecretName: clientSecretName as string,
      });
  }
  const google = ['googleClientId', 'googleClientSecretName'].map(read);
  if (google.some((value) => value !== undefined)) {
    const [clientId, clientSecretName] = google;
    if (typeof clientId !== 'string' || typeof clientSecretName !== 'string')
      errors.push('Google sign-in needs googleClientId and googleClientSecretName');
    else providers.push({ kind: 'google', clientId, clientSecretName });
  }
  return providers;
}

function readAnomalyAlerts(read: ContextReader, errors: string[]): AnomalyAlerts {
  const create = parseBoolean(read('createAnomalyMonitor'), false);
  const monitorArn = read('anomalyMonitorArn');
  const thresholdUsd = parseNumber(read('anomalyThresholdUsd'), DEFAULT_ANOMALY_THRESHOLD_USD);

  if (create === undefined) errors.push('createAnomalyMonitor must be true or false');
  if (thresholdUsd === undefined || thresholdUsd <= 0) {
    errors.push('anomalyThresholdUsd must be a positive number');
  }
  if (
    monitorArn !== undefined &&
    (typeof monitorArn !== 'string' ||
      !/^arn:aws[\w-]*:ce::\d{12}:anomalymonitor\/.+$/.test(monitorArn))
  ) {
    errors.push(
      `anomalyMonitorArn must be a Cost Anomaly Detection monitor ARN (got ${describe(monitorArn)})`,
    );
  }
  if (create && monitorArn !== undefined) {
    errors.push('set either createAnomalyMonitor=true or anomalyMonitorArn, not both');
  }

  const threshold = thresholdUsd ?? DEFAULT_ANOMALY_THRESHOLD_USD;
  if (typeof monitorArn === 'string')
    return { mode: 'subscribe', monitorArn, thresholdUsd: threshold };
  if (create) return { mode: 'create', thresholdUsd: threshold };
  return { mode: 'none' };
}

function readSwitches(
  read: ContextReader,
  defaults: ScaleSwitches,
  errors: string[],
): ScaleSwitches {
  const gatewayNlb = parseBoolean(read('gatewayNlb'), defaults.gatewayNlb);
  const multiAz = parseBoolean(read('multiAz'), defaults.multiAz);
  const backbone = read('backbone') ?? defaults.backbone;
  const dynamoCapacity = read('dynamoCapacity') ?? defaults.dynamoCapacity;

  if (gatewayNlb === undefined) errors.push('gatewayNlb must be true or false');
  if (multiAz === undefined) errors.push('multiAz must be true or false');
  if (!isOneOf(backbone, BACKBONES)) {
    errors.push(`backbone must be one of ${BACKBONES.join(', ')} (got ${describe(backbone)})`);
  }
  if (!isOneOf(dynamoCapacity, DYNAMO_CAPACITY_MODES)) {
    errors.push(
      `dynamoCapacity must be one of ${DYNAMO_CAPACITY_MODES.join(', ')} (got ${describe(dynamoCapacity)})`,
    );
  }

  return {
    gatewayNlb: gatewayNlb ?? defaults.gatewayNlb,
    multiAz: multiAz ?? defaults.multiAz,
    backbone: isOneOf(backbone, BACKBONES) ? backbone : defaults.backbone,
    dynamoCapacity: isOneOf(dynamoCapacity, DYNAMO_CAPACITY_MODES)
      ? dynamoCapacity
      : defaults.dynamoCapacity,
  };
}

/** CLI context values arrive as strings; cdk.json values arrive typed. Accept both. */
function parseBoolean(value: unknown, fallback: boolean): boolean | undefined {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function parseNumber(value: unknown, fallback: number): number | undefined {
  if (value === undefined) return fallback;
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function describe(value: unknown): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}
