export interface BootstrapArguments {
  email: string;
  tenantName: string;
  userPoolId: string;
  coreTable: string;
  region: string;
}

export function parseArguments(values: string[]): BootstrapArguments {
  const options = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || !value) throw usage();
    options.set(key.slice(2), value);
  }
  const email = options.get('email');
  const tenantName = options.get('tenant-name');
  const userPoolId = options.get('user-pool-id');
  const coreTable = options.get('core-table');
  const region = options.get('region') ?? 'ap-south-1';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw usage();
  if (!tenantName || !userPoolId || !coreTable || !/^[a-z]{2}(-[a-z]+)+-\d$/.test(region))
    throw usage();
  return { email, tenantName, userPoolId, coreTable, region };
}

function usage() {
  return new Error(
    'usage: npm start -- --email admin@example.com --tenant-name "Fleet" --user-pool-id ID --core-table TABLE [--region ap-south-1]',
  );
}
