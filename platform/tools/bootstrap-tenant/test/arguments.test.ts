import { describe, expect, it } from 'vitest';
import { parseArguments } from '../src/arguments';

describe('bootstrap tenant arguments', () => {
  it('parses required values with the Mumbai default region', () => {
    expect(
      parseArguments([
        '--email',
        'admin@example.com',
        '--tenant-name',
        'Example Fleet',
        '--user-pool-id',
        'ap-south-1_example',
        '--core-table',
        'CoreTable',
      ]),
    ).toMatchObject({ email: 'admin@example.com', region: 'ap-south-1' });
  });

  it('rejects incomplete input', () => {
    expect(() => parseArguments(['--email', 'invalid'])).toThrow('usage');
  });
});
