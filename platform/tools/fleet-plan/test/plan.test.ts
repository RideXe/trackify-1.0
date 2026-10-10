import { describe, expect, it, vi } from 'vitest';
import { parseArguments, setPlan } from '../src/plan';

describe('fleet plan tool', () => {
  it('accepts only known plans and all required arguments', () => {
    expect(
      parseArguments(['--tenant-id', 't', '--plan', 'premium', '--core-table', 'core']),
    ).toEqual({
      tenantId: 't',
      plan: 'premium',
      coreTable: 'core',
    });
    expect(() =>
      parseArguments(['--tenant-id', 't', '--plan', 'gold', '--core-table', 'core']),
    ).toThrow(/usage/);
    expect(() => parseArguments(['--plan', 'basic'])).toThrow(/usage/);
  });

  it('sets the plan on an existing fleet and reports the new limit', async () => {
    const send = vi.fn().mockResolvedValue({ Attributes: { plan: 'basic' } });
    const result = await setPlan({ send }, { tenantId: 't', plan: 'premium', coreTable: 'core' });
    expect(result).toEqual({
      tenantId: 't',
      previousPlan: 'basic',
      plan: 'premium',
      fastestSyncSeconds: 5,
    });
    const input = (send.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({
      Key: { pk: 'TENANT#t', sk: 'META' },
      ConditionExpression: 'attribute_exists(pk)',
    });
  });
});
