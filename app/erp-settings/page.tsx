'use client';

import { useState, useEffect } from 'react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

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
    } catch {
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
    } catch {
      setMessage({ type: 'error', text: 'Error syncing orders' });
    } finally {
      setSyncing(false);
    }
  };

  const toggleAutoSync = async (checked: boolean) => {
    await updateSetting('erp_auto_sync_enabled', checked ? 'true' : 'false');
  };

  const autoSyncSetting = settings.find((s) => s.key === 'erp_auto_sync_enabled');
  const isAutoSyncEnabled = autoSyncSetting?.value === 'true';

  if (loading) {
    return (
      <AppPageShell title="ERP Integration Settings" subtitle="Configure sync behavior and monitor sync health">
        <LoadingState label="Loading ERP settings..." />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell title="ERP Integration Settings" subtitle="Configure sync behavior and monitor sync health">
      <div className="mx-auto w-full max-w-4xl space-y-6">

      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {/* Sync Statistics */}
      {stats && (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>Sync Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600">{stats.total}</div>
                <div className="text-sm text-muted-foreground">Total Orders</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">{stats.synced}</div>
                <div className="text-sm text-muted-foreground">Synced</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-yellow-600">{stats.unsynced}</div>
                <div className="text-sm text-muted-foreground">Unsynced</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-red-600">{stats.failed}</div>
                <div className="text-sm text-muted-foreground">Failed</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual Sync */}
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>Manual Sync</CardTitle>
          <CardDescription>Manually sync all unsynced orders to your ERP system.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={syncAllUnsynced} disabled={syncing || stats?.unsynced === 0}>
            {syncing ? 'Syncing...' : `Sync ${stats?.unsynced || 0} Unsynced Orders`}
          </Button>
        </CardContent>
      </Card>

      {/* Auto Sync Settings */}
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>Automatic Sync</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <Switch checked={isAutoSyncEnabled} onCheckedChange={toggleAutoSync} />
              <div>
                <FieldLabel>{isAutoSyncEnabled ? 'Enabled' : 'Disabled'}</FieldLabel>
                <FieldDescription>{autoSyncSetting?.description}</FieldDescription>
              </div>
            </Field>

        {/* Status Filter */}
        {settings
          .filter((s) => s.key === 'erp_auto_sync_on_status')
          .map((setting) => (
            <Field key={setting.key}>
              <FieldLabel htmlFor={setting.key}>
                Auto-sync on statuses:
              </FieldLabel>
              <Input
                id={setting.key}
                type="text"
                value={setting.value}
                onChange={(e) => updateSetting(setting.key, e.target.value)}
                placeholder="completed,ready_to_ship"
              />
              <FieldDescription>{setting.description}</FieldDescription>
            </Field>
          ))}
          </FieldGroup>
        </CardContent>
      </Card>

      {/* All Settings */}
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>All ERP Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {settings.map((setting) => (
              <div key={setting.key} className="border-b pb-4 last:border-b-0">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <code className="text-sm font-mono text-foreground">{setting.key}</code>
                    <p className="text-sm text-muted-foreground mt-1">{setting.description}</p>
                  </div>
                  <div className="ml-4 text-right">
                    <code className="rounded bg-muted px-2 py-1 text-sm">
                      {setting.value}
                    </code>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      </div>
    </AppPageShell>
  );
}
