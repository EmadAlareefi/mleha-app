import AppNavbar from '@/components/AppNavbar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { prisma } from '@/lib/prisma';
import { BadgeCheck, Database, RefreshCcw, ServerCrash } from 'lucide-react';

const MAX_SHIPMENTS = 20;

function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return value.toString();
  }
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatMoney(value: any) {
  if (value === null || value === undefined) return '—';
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : typeof value?.toNumber === 'function'
          ? value.toNumber()
          : Number(value);
  if (Number.isNaN(numeric)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'SAR',
  }).format(numeric);
}

const statusBadgeClasses = (delivered: boolean | null | undefined) =>
  delivered
    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
    : 'bg-amber-50 text-amber-700 border border-amber-100';

export default async function SmsaWebhookPage() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [shipments, totalShipments, deliveredShipments, lastDayShipments, totalScans] =
    await Promise.all([
      prisma.smsaWebhookShipment.findMany({
        orderBy: { updatedAt: 'desc' },
        include: {
          scans: {
            orderBy: { scanDateTime: 'desc' },
            take: 5,
          },
        },
        take: MAX_SHIPMENTS,
      }),
      prisma.smsaWebhookShipment.count(),
      prisma.smsaWebhookShipment.count({ where: { isDelivered: true } }),
      prisma.smsaWebhookShipment.count({ where: { updatedAt: { gte: since24h } } }),
      prisma.smsaWebhookScan.count(),
    ]);

  const stats = [
    {
      label: 'Total shipments',
      value: totalShipments.toLocaleString(),
      icon: Database,
      description: 'All unique AWBs recorded from SMSA',
    },
    {
      label: 'Delivered shipments',
      value: deliveredShipments.toLocaleString(),
      icon: BadgeCheck,
      description: 'Webhook marked these as delivered',
    },
    {
      label: 'Updates (24h)',
      value: lastDayShipments.toLocaleString(),
      icon: RefreshCcw,
      description: 'Shipments touched in the last 24 hours',
    },
    {
      label: 'Scan entries',
      value: totalScans.toLocaleString(),
      icon: ServerCrash,
      description: 'Individual tracking scans saved',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <AppNavbar title="سجل ويب هوك سمسا" subtitle="راقب أحدث الشحنات وعمليات المسح" />

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card
              key={stat.label}
              className="rounded-3xl border border-white/70 bg-white/90 shadow-lg shadow-indigo-100/50"
            >
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center gap-3 text-slate-500">
                  <stat.icon className="h-5 w-5" />
                  <span className="text-sm font-medium">{stat.label}</span>
                </div>
                <p className="text-3xl font-semibold text-slate-900">{stat.value}</p>
                <p className="text-xs text-slate-500">{stat.description}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Latest webhook deliveries</h2>
            <p className="text-sm text-slate-500">
              Showing the last {shipments.length} AWBs received from SMSA. For each shipment we keep
              the top 5 scans (newest first).
            </p>
          </div>

          {shipments.length === 0 ? (
            <Card className="rounded-3xl border border-dashed border-slate-200 bg-white/70 p-8 text-center text-slate-500">
              No webhook calls received yet. Once SMSA posts to `/api/webhooks/smsa/scans` the
              payloads will appear here.
            </Card>
          ) : (
            <div className="space-y-4">
              {shipments.map((shipment) => (
                <Card
                  key={shipment.id}
                  className="rounded-3xl border border-slate-200 bg-white/95 shadow-sm"
                >
                  <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="text-lg font-semibold text-slate-900">
                        AWB #{shipment.awb}
                      </CardTitle>
                      <CardDescription className="text-sm text-slate-600">
                        Reference: {shipment.reference || '—'} · Pieces: {shipment.pieces ?? '—'} ·
                        COD: {formatMoney(shipment.codAmount)}
                      </CardDescription>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClasses(shipment.isDelivered)}`}>
                      {shipment.isDelivered ? 'Delivered' : 'In transit'}
                    </span>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-400">Recipient</p>
                        <p className="text-sm text-slate-900">{shipment.recipientName || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-400">Route</p>
                        <p className="text-sm text-slate-900">
                          {shipment.originCity || '—'} → {shipment.destinationCity || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-400">Last scan</p>
                        <p className="text-sm text-slate-900">{formatDate(shipment.lastScanDateTime)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-400">Updated</p>
                        <p className="text-sm text-slate-900">{formatDate(shipment.updatedAt)}</p>
                      </div>
                    </div>

                    {shipment.scans.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">
                        No scan details captured for this webhook payload.
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-2xl border border-slate-100">
                        <table className="min-w-full divide-y divide-slate-100 text-sm">
                          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-4 py-3 text-left">Scan</th>
                              <th className="px-4 py-3 text-left">Description</th>
                              <th className="px-4 py-3 text-left">City</th>
                              <th className="px-4 py-3 text-left">Timestamp</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {shipment.scans.map((scan) => (
                              <tr key={scan.id}>
                                <td className="px-4 py-3 font-mono text-xs text-slate-700">
                                  {scan.scanType || '—'}
                                </td>
                                <td className="px-4 py-3 text-slate-900">{scan.scanDescription || '—'}</td>
                                <td className="px-4 py-3 text-slate-700">{scan.city || '—'}</td>
                                <td className="px-4 py-3 text-slate-700">
                                  {formatDate(scan.scanDateTime)}
                                  {scan.scanTimeZone ? (
                                    <span className="ms-1 text-xs text-slate-500">{scan.scanTimeZone}</span>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {shipment.contentDesc ? (
                      <div className="rounded-2xl bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
                        <span className="font-medium text-slate-800">Content:</span> {shipment.contentDesc}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
