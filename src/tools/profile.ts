import { OuraClient } from '../oura-client.js';
import { OuraPersonalInfo } from '../types.js';
import { logger } from '../logger.js';

export async function getPersonalInfo(ouraClient: OuraClient): Promise<string> {
  logger.debug('Tool: get_personal_info');

  const info = await ouraClient.get<OuraPersonalInfo>('/v2/usercollection/personal_info');

  const parts: string[] = [];
  if (info.age !== undefined) parts.push(`Age: ${info.age}`);
  if (info.biological_sex !== undefined) {
    const sex = info.biological_sex.charAt(0).toUpperCase() + info.biological_sex.slice(1);
    parts.push(`Sex: ${sex}`);
  }
  if (info.height !== undefined) parts.push(`Height: ${info.height.toFixed(2)}m`);
  if (info.weight !== undefined) parts.push(`Weight: ${info.weight.toFixed(1)}kg`);

  if (parts.length === 0) {
    return 'No personal info available.';
  }

  return parts.join('  |  ');
}
