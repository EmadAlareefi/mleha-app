'use client';

import { useState, useEffect } from 'react';

interface Setting {
  key: string;
  value: string;
  description: string | null;
}

interface SyncStats {
  total: number;
  synced: number;
  unsynced: number;
  failed: number;
}

export default function ERPSettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load settings and stats
  useEffect(() => {
    loadSettings();
    loadStats();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.success) {
        // Filter ERP-related settings
        const erpSettings = data.settings.filter((s: Setting) =>
          s.key.startsWith('erp_')
        );
        setSettings(erpSettings);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const res = await fetch('/api/erp/stats');
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const updateSetting = async (key: string, value: string) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: 'Setting updated successfully' });
        loadSettings();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update setting' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error updating setting' });
    }

    setTimeout(() => setMessage(null), 3000);
  };

  const syncAllUnsynced = async () => {
    if (!confirm('Sync all unsynced orders to ERP?')) return;

    setSyncing(true);
    setMessage(null);

    try {
      const res = await fetch('/api/erp/sync-orders-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: { onlyUnsynced: true },
          limit: 1000,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage({
          type: 'success',
          text: `${data.summary.successful} orders synced successfully (${data.summary.failed} failed, ${data.summary.skipped} skipped)`,
        });
        loadStats();
      } else {
        setMessage({ type: 'error', text: data.error || 'Sync failed' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error syncing orders' });
    } finally {
      setSyncing(false);
    }
  };

  const toggleAutoSync = async (currentValue: string) => {
    const newValue = currentValue === 'true' ? 'false' : 'true';
    await updateSetting('erp_auto_sync_enabled', newValue);
  };

  const autoSyncSetting = settings.find((s) => s.key === 'erp_auto_sync_enabled');
  const isAutoSyncEnabled = autoSyncSetting?.value === 'true';

  if (loading) {
    return (
      <div className="p-8">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">ERP Integration Settings</h1>

      {message && (
        <div
          className={`mb-4 p-4 rounded ${
            message.type === 'success'
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Sync Statistics */}
      {stats && (
        <div className="mb-8 p-6 bg-gray-50 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">Sync Statistics</h2>
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600">{stats.total}</div>
              <div className="text-sm text-gray-600">Total Orders</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">{stats.synced}</div>
              <div className="text-sm text-gray-600">Synced</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-yellow-600">{stats.unsynced}</div>
              <div className="text-sm text-gray-600">Unsynced</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-red-600">{stats.failed}</div>
              <div className="text-sm text-gray-600">Failed</div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Sync */}
      <div className="mb-8 p-6 bg-white border rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Manual Sync</h2>
        <p className="text-gray-600 mb-4">
          Manually sync all unsynced orders to your ERP system.
        </p>
        <button
          onClick={syncAllUnsynced}
          disabled={syncing || stats?.unsynced === 0}
          className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {syncing ? 'Syncing...' : `Sync ${stats?.unsynced || 0} Unsynced Orders`}
        </button>
      </div>

      {/* Auto Sync Settings */}
      <div className="mb-8 p-6 bg-white border rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Automatic Sync</h2>

        {/* Toggle */}
        <div className="mb-6">
          <label className="flex items-center space-x-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={isAutoSyncEnabled}
                onChange={() => toggleAutoSync(autoSyncSetting?.value || 'false')}
                className="sr-only"
              />
              <div
                className={`w-14 h-8 rounded-full shadow-inner transition ${
                  isAutoSyncEnabled ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              ></div>
              <div
                className={`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${
                  isAutoSyncEnabled ? 'transform translate-x-6' : ''
                }`}
              ></div>
            </div>
            <span className="font-medium">
              {isAutoSyncEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>
          <p className="text-sm text-gray-600 mt-2">
            {autoSyncSetting?.description}
          </p>
        </div>

        {/* Status Filter */}
        {settings
          .filter((s) => s.key === 'erp_auto_sync_on_status')
          .map((setting) => (
            <div key={setting.key} className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Auto-sync on statuses:
              </label>
              <input
                type="text"
                value={setting.value}
                onChange={(e) => updateSetting(setting.key, e.target.value)}
                className="w-full px-4 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                placeholder="completed,ready_to_ship"
              />
              <p className="text-sm text-gray-600 mt-1">{setting.description}</p>
            </div>
          ))}
      </div>

      {/* All Settings */}
      <div className="p-6 bg-white border rounded-lg">
        <h2 className="text-xl font-semibold mb-4">All ERP Settings</h2>
        <div className="space-y-4">
          {settings.map((setting) => (
            <div key={setting.key} className="border-b pb-4 last:border-b-0">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <code className="text-sm font-mono text-gray-800">{setting.key}</code>
                  <p className="text-sm text-gray-600 mt-1">{setting.description}</p>
                </div>
                <div className="ml-4 text-right">
                  <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                    {setting.value}
                  </code>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
