#!/usr/bin/env node
import { App, AspectPriority, Aspects, Tags } from 'aws-cdk-lib';
import { CostGuardrails } from '../lib/aspects/cost-guardrails';
import { loadConfig } from '../lib/config';
import { FoundationStack } from '../lib/stacks/foundation-stack';
import { DataStack } from '../lib/stacks/data-stack';
import { IngestStack } from '../lib/stacks/ingest-stack';
import { GatewayStack } from '../lib/stacks/gateway-stack';
import { IdentityStack } from '../lib/stacks/identity-stack';
import { RealtimeStack } from '../lib/stacks/realtime-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { HostingStack } from '../lib/stacks/hosting-stack';
import { DashboardAssetsStack } from '../lib/stacks/dashboard-assets-stack';
import { OperationsStack } from '../lib/stacks/operations-stack';
import { ArchiveStack } from '../lib/stacks/archive-stack';

const app = new App();
const config = loadConfig((key) => app.node.tryGetContext(key));

const tags = { project: 'trackify', environment: config.envName, 'managed-by': 'cdk' };
for (const [key, value] of Object.entries(tags)) {
  Tags.of(app).add(key, value);
}

new FoundationStack(app, `Trackify-${config.envName}-Foundation`, {
  env: { account: config.account, region: config.region },
  description: 'Trackify cost controls: monthly budget and anomaly alerts',
  terminationProtection: config.envName === 'prod',
  tags,
  config,
});

const data = new DataStack(app, `Trackify-${config.envName}-Data`, {
  env: { account: config.account, region: config.region },
  config,
  terminationProtection: config.envName === 'prod',
  tags,
});
new ArchiveStack(app, `Trackify-${config.envName}-Archive`, {
  env: { account: config.account, region: config.region },
  config,
  data,
  terminationProtection: config.envName === 'prod',
  tags,
});
const platformPath = new URL('../..', import.meta.url).pathname;
const hosting = new HostingStack(app, `Trackify-${config.envName}-Hosting`, {
  env: { account: config.account, region: config.region },
  config,
  terminationProtection: config.envName === 'prod',
  tags,
});
const identity = new IdentityStack(app, `Trackify-${config.envName}-Identity`, {
  env: { account: config.account, region: config.region },
  config,
  dashboardUrl: hosting.dashboardUrl,
  terminationProtection: config.envName === 'prod',
  tags,
});
const realtime = new RealtimeStack(app, `Trackify-${config.envName}-Realtime`, {
  env: { account: config.account, region: config.region },
  config,
  data,
  identity,
  platformPath,
  tags,
});
const api = new ApiStack(app, `Trackify-${config.envName}-Api`, {
  env: { account: config.account, region: config.region },
  config,
  data,
  identity,
  platformPath,
  dashboardUrl: hosting.dashboardUrl,
  tags,
});
new DashboardAssetsStack(app, `Trackify-${config.envName}-DashboardAssets`, {
  env: { account: config.account, region: config.region },
  hosting,
  identity,
  api,
  realtime,
  platformPath,
  tags,
});
const ingest = new IngestStack(app, `Trackify-${config.envName}-Ingest`, {
  env: { account: config.account, region: config.region },
  config,
  data,
  platformPath,
  realtime,
  tags,
});
new OperationsStack(app, `Trackify-${config.envName}-Operations`, {
  env: { account: config.account, region: config.region },
  config,
  data,
  platformPath,
  tags,
});
if (config.enableGateway) {
  new GatewayStack(app, `Trackify-${config.envName}-Gateway`, {
    env: { account: config.account, region: config.region },
    config,
    data,
    ingest,
    platformPath,
    tags,
  });
}

Aspects.of(app).add(new CostGuardrails(config.switches), { priority: AspectPriority.READONLY });
