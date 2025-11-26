/**
 * Application Settings Management
 *
 * Provides utilities for managing application settings stored in the database.
 */

import { prisma } from '@/lib/prisma';
import { log as logger } from './logger';

export type SettingKey =
  | 'erp_auto_sync_enabled'
  | 'erp_auto_sync_on_status'
  | 'erp_sync_delay_seconds';

interface SettingDefinition {
  key: SettingKey;
  defaultValue: string;
  description: string;
}

const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: 'erp_auto_sync_enabled',
    defaultValue: 'false',
    description: 'Automatically sync orders to ERP when status changes',
  },
  {
    key: 'erp_auto_sync_on_status',
    defaultValue: 'completed,ready_to_ship',
    description: 'Order statuses that trigger automatic ERP sync (comma-separated)',
  },
  {
    key: 'erp_sync_delay_seconds',
    defaultValue: '0',
    description: 'Delay in seconds before syncing to ERP (useful for batch processing)',
  },
];

/**
 * Get a setting value from the database
 * Returns the default value if not found
 */
export async function getSetting(key: SettingKey): Promise<string> {
  try {
    const setting = await prisma.settings.findUnique({
      where: { key },
    });

    if (setting) {
      return setting.value;
    }

    // Return default value
    const definition = SETTING_DEFINITIONS.find((s) => s.key === key);
    return definition?.defaultValue || '';
  } catch (error: any) {
    logger.error('Error getting setting', { key, error: error.message });
    const definition = SETTING_DEFINITIONS.find((s) => s.key === key);
    return definition?.defaultValue || '';
  }
}

/**
 * Get a setting as a boolean
 */
export async function getSettingBoolean(key: SettingKey): Promise<boolean> {
  const value = await getSetting(key);
  return value === 'true' || value === '1';
}

/**
 * Get a setting as a number
 */
export async function getSettingNumber(key: SettingKey): Promise<number> {
  const value = await getSetting(key);
  return parseInt(value, 10) || 0;
}

/**
 * Get a setting as an array (comma-separated)
 */
export async function getSettingArray(key: SettingKey): Promise<string[]> {
  const value = await getSetting(key);
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Set a setting value
 */
export async function setSetting(
  key: SettingKey,
  value: string,
  description?: string
): Promise<void> {
  try {
    const definition = SETTING_DEFINITIONS.find((s) => s.key === key);

    await prisma.settings.upsert({
      where: { key },
      create: {
        key,
        value,
        description: description || definition?.description || '',
      },
      update: {
        value,
        ...(description && { description }),
      },
    });

    logger.info('Setting updated', { key, value });
  } catch (error: any) {
    logger.error('Error setting value', {
      key,
      value,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Initialize default settings
 */
export async function initializeSettings(): Promise<void> {
  try {
    for (const definition of SETTING_DEFINITIONS) {
      const existing = await prisma.settings.findUnique({
        where: { key: definition.key },
      });

      if (!existing) {
        await prisma.settings.create({
          data: {
            key: definition.key,
            value: definition.defaultValue,
            description: definition.description,
          },
        });
        logger.info('Setting initialized', {
          key: definition.key,
          value: definition.defaultValue,
        });
      }
    }
  } catch (error: any) {
    logger.error('Error initializing settings', { error: error.message });
  }
}

/**
 * Get all settings
 */
export async function getAllSettings(): Promise<
  Array<{ key: string; value: string; description: string | null }>
> {
  try {
    const settings = await prisma.settings.findMany({
      orderBy: { key: 'asc' },
    });
    return settings;
  } catch (error: any) {
    logger.error('Error getting all settings', { error: error.message });
    return [];
  }
}

/**
 * Check if ERP auto-sync is enabled
 */
export async function isERPAutoSyncEnabled(): Promise<boolean> {
  return await getSettingBoolean('erp_auto_sync_enabled');
}

/**
 * Get the list of statuses that trigger ERP auto-sync
 */
export async function getERPAutoSyncStatuses(): Promise<string[]> {
  return await getSettingArray('erp_auto_sync_on_status');
}

/**
 * Check if a status should trigger ERP auto-sync
 */
export async function shouldAutoSyncForStatus(
  status: string
): Promise<boolean> {
  const enabled = await isERPAutoSyncEnabled();
  if (!enabled) {
    return false;
  }

  const statuses = await getERPAutoSyncStatuses();
  return statuses.includes(status);
}
