/** The drill's last setup, remembered per browser (a convenience: anything unreadable is the default). */
import type { DrillConfig } from '@ipp/contracts';
import { storage } from '@/lib/storage';
import { parseSetup } from './logic';

export const DRILL_SETUP_KEY = 'ipp:drill-setup';

export const loadDrillSetup = (): DrillConfig =>
  parseSetup(storage.get<unknown>(DRILL_SETUP_KEY, null));

export const saveDrillSetup = (c: DrillConfig) => storage.set(DRILL_SETUP_KEY, c);
