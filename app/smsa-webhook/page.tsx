import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState } from '@/components/dashboard/states';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
    <AppPageShell title="سجل ويب هوك سمسا" subtitle="راقب أحدث الشحنات وعمليات المسح">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.label} className="rounded-lg">
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <stat.icon className="h-5 w-5" />
                  <span className="text-sm font-medium">{stat.label}</span>
                </div>
                <p className="text-3xl font-semibold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.description}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">Latest webhook deliveries</h2>
            <p className="text-sm text-muted-foreground">
              Showing the last {shipments.length} AWBs received from SMSA. For each shipment we keep
              the top 5 scans (newest first).
            </p>
          </div>

          {shipments.length === 0 ? (
            <EmptyState
              title="No webhook calls received yet"
              description="Once SMSA posts to /api/webhooks/smsa/scans the payloads will appear here."
            />
          ) : (
            <div className="space-y-4">
              {shipments.map((shipment) => (
                <Card key={shipment.id} className="rounded-lg">
                  <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="text-lg font-semibold">
                        AWB #{shipment.awb}
                      </CardTitle>
                      <CardDescription className="text-sm">
                        Reference: {shipment.reference || '—'} · Pieces: {shipment.pieces ?? '—'} ·
                        COD: {formatMoney(shipment.codAmount)}
                      </CardDescription>
                    </div>
                    <Badge variant={shipment.isDelivered ? 'default' : 'secondary'}>
                      {shipment.isDelivered ? 'Delivered' : 'In transit'}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Recipient</p>
                        <p className="text-sm text-foreground">{shipment.recipientName || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Route</p>
                        <p className="text-sm text-foreground">
                          {shipment.originCity || '—'} → {shipment.destinationCity || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Last scan</p>
                        <p className="text-sm text-foreground">{formatDate(shipment.lastScanDateTime)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Updated</p>
                        <p className="text-sm text-foreground">{formatDate(shipment.updatedAt)}</p>
                      </div>
                    </div>

                    {shipment.scans.length === 0 ? (
                      <div className="rounded-lg border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
                        No scan details captured for this webhook payload.
                      </div>
                    ) : (
                      <div className="rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-left">Scan</TableHead>
                              <TableHead className="text-left">Description</TableHead>
                              <TableHead className="text-left">City</TableHead>
                              <TableHead className="text-left">Timestamp</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {shipment.scans.map((scan) => (
                              <TableRow key={scan.id}>
                                <TableCell className="font-mono text-xs">
                                  {scan.scanType || '—'}
                                </TableCell>
                                <TableCell>{scan.scanDescription || '—'}</TableCell>
                                <TableCell>{scan.city || '—'}</TableCell>
                                <TableCell>
                                  {formatDate(scan.scanDateTime)}
                                  {scan.scanTimeZone ? (
                                    <span className="ms-1 text-xs text-muted-foreground">{scan.scanTimeZone}</span>
                                  ) : null}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {shipment.contentDesc ? (
                      <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Content:</span> {shipment.contentDesc}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppPageShell>
  );
}
