import { DEFAULT_APP_SETTINGS, type AppSettings } from '@costing/validators';
import { NumberingService } from './numbering.service';

/** Settings and numbering for service tests: built-in defaults, optionally adjusted per test. */
export function testSettings(patch: (s: AppSettings) => AppSettings = (s) => s) {
  const current = patch(structuredClone(DEFAULT_APP_SETTINGS));
  const appSettings: any = { get: jest.fn(async () => current) };
  return { appSettings, numbering: new NumberingService({} as never, appSettings), current };
}
