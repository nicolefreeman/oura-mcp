import { jest } from '@jest/globals';
import { getPersonalInfo } from '../../tools/profile.js';
import type { OuraClient } from '../../oura-client.js';

function makeClient(info: object): OuraClient {
  return {
    get: jest.fn().mockResolvedValue(info),
    getPaginated: jest.fn(),
  } as unknown as OuraClient;
}

describe('getPersonalInfo', () => {
  it('formats all available fields', async () => {
    const client = makeClient({ age: 32, biological_sex: 'female', height: 1.68, weight: 62.5 });
    const result = await getPersonalInfo(client);
    expect(result).toContain('Age: 32');
    expect(result).toContain('Sex: Female');
    expect(result).toContain('Height: 1.68m');
    expect(result).toContain('Weight: 62.5kg');
  });

  it('omits fields that are undefined', async () => {
    const client = makeClient({ age: 28, biological_sex: undefined, height: undefined, weight: 70 });
    const result = await getPersonalInfo(client);
    expect(result).toContain('Age: 28');
    expect(result).toContain('Weight: 70.0kg');
    expect(result).not.toContain('Sex:');
    expect(result).not.toContain('Height:');
  });

  it('capitalises biological_sex', async () => {
    const client = makeClient({ biological_sex: 'male' });
    const result = await getPersonalInfo(client);
    expect(result).toContain('Sex: Male');
  });

  it('returns fallback message when no fields are present', async () => {
    const client = makeClient({});
    const result = await getPersonalInfo(client);
    expect(result).toBe('No personal info available.');
  });

  it('formats height with two decimal places', async () => {
    const client = makeClient({ height: 1.8 });
    const result = await getPersonalInfo(client);
    expect(result).toContain('Height: 1.80m');
  });
});
