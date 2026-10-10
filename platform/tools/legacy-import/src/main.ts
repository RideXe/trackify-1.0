import {
  createDocumentClient,
  DynamoAdminStore,
  DynamoFleetStore,
  DynamoNotificationStore,
} from '@trackify/data';
import { applyPlan } from './apply';
import { LegacyClient } from './legacy';
import { planImport } from './mapping';

const usage = `usage: npm start -w @trackify/legacy-import -- \\
  --legacy-url https://old.example.com --legacy-email admin@example.com \\
  --tenant-id <tenant> --core-table <CoreTable> --state-table <DeviceStateTable> \\
  [--default-protocol gt06] [--apply]

The legacy password is read from LEGACY_PASSWORD. Without --apply nothing is written.
AWS credentials come from the usual environment or profile.`;

function parse(args: string[]) {
  const options = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith('--')) throw new Error(usage);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) options.set(key.slice(2), true);
    else {
      options.set(key.slice(2), value);
      index += 1;
    }
  }
  const text = (name: string) => {
    const value = options.get(name);
    if (typeof value !== 'string') throw new Error(`--${name} is required\n\n${usage}`);
    return value;
  };
  return {
    legacyUrl: text('legacy-url'),
    legacyEmail: text('legacy-email'),
    tenantId: text('tenant-id'),
    coreTable: text('core-table'),
    stateTable: text('state-table'),
    defaultProtocol:
      typeof options.get('default-protocol') === 'string'
        ? (options.get('default-protocol') as string)
        : undefined,
    apply: options.get('apply') === true,
  };
}

const options = parse(process.argv.slice(2));
const password = process.env.LEGACY_PASSWORD;
if (!password) throw new Error('LEGACY_PASSWORD is required');

const legacy = LegacyClient.withPassword(options.legacyUrl, options.legacyEmail, password);
const plan = planImport(await legacy.load(), options.defaultProtocol);
console.info(
  JSON.stringify(
    {
      groups: plan.groups.length,
      vehicles: plan.devices.length,
      geofences: plan.geofences.length,
      drivers: plan.drivers.length,
      alertRules: plan.rules.length,
      maintenances: plan.maintenances.length,
      computedAttributes: plan.computed.length,
    },
    null,
    2,
  ),
);
for (const warning of plan.warnings) console.warn(`! ${warning}`);
console.info('\nUsers to invite from the dashboard (email,role):');
for (const user of plan.users) console.info(`${user.email},${user.role}`);

if (!options.apply) {
  console.info('\nDry run: nothing was written. Re-run with --apply to import.');
} else {
  const client = createDocumentClient();
  const result = await applyPlan(plan, options.tenantId, {
    admin: new DynamoAdminStore(client, options.coreTable),
    fleet: new DynamoFleetStore(client, options.coreTable, options.stateTable, ''),
    notifications: new DynamoNotificationStore(client, options.coreTable),
  });
  console.info('\nImported:', JSON.stringify(result.created));
  for (const line of result.skipped) console.info(`= ${line}`);
}
