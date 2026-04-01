'use client';

import AppNavbar from '@/components/AppNavbar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CheckCircle2, ListChecks, Server } from 'lucide-react';

const registrationSteps = [
  'Create New Webhook Request.',
  'Waiting For Approval.',
  'After approval wait for a new scans under your account.',
  'This is a sample request that your endpoint will receive.',
];

const querySteps = [
  'When Get Activated your registration.',
  'Generated API Key.',
  'Type Your Request To Get Latest Scans After Webhook Registeration.',
  'Or add a scan reference Id to your request to get scans with reference Ids after it.',
];

const webhookCurlSample = `curl --location --request POST 'https://Endpoint...' \\
--header 'Content-Type: application/json' \\
--data-raw '[{
    "AWB": "231200021000",
    "Reference": "REF1234567890",
    "Pieces": 1,
    "CODAmount": 0.0,
    "ContentDesc": "Shipment contents description",
    "RecipientName": "Abdulaziz",
    "OriginCity": "Jeddah",
    "OriginCountry": "SA",
    "DesinationCity": "Riyadh",
    "DesinationCountry": "SA",
    "isDelivered": true, // Only in delivered Shipment
    "Scans": [
        {
            "ReferenceID": 10611,
            "ReceivedBy": "Abdulaziz", // Only in delivered Shipment
            "City": "Riyadh",
            "ScanType": "DL",
            "ScanDescription": "Delivered",
            "ScanDateTime": "2024-01-10T11:00:00",
            "ScanTimeZone": "+03:00"
        },
        {
            "ReferenceID": 10541,
            "City": "Riyadh",
            "ScanType": "OD",
            "ScanDescription": "Out for Delivery",
            "ScanDateTime": "2024-01-10T10:00:00",
            "ScanTimeZone": "+03:00"
        },
        {
            "ReferenceID": 10354,
            "City": "Jeddah",
            "ScanType": "AF",
            "ScanDescription": "Arrived Delivery Facility",
            "ScanDateTime": "2024-01-10T09:00:00",
            "ScanTimeZone": "+03:00"
        }
    ]
}]'`;

const webhookRequestSample = `[
    {
        "AWB": "231200021000",
        "Reference": "REF1234567890",
        "Pieces": 1,
        "CODAmount": 0.0,
        "ContentDesc": "Shipment contents description",
        "RecipientName": "Abdulaziz",
        "OriginCity": "Jeddah",
        "OriginCountry": "SA",
        "DesinationCity": "Riyadh",
        "DesinationCountry": "SA",
        "isDelivered": true, // Only in delivered Shipment
        "Scans": [
            {
                "ReferenceID": 10611,
                "ReceivedBy": "Abdulaziz", // Only in delivered Shipment
                "City": "Riyadh",
                "ScanType": "DL",
                "ScanDescription": "Delivered",
                "ScanDateTime": "2024-01-10T11:00:00",
                "ScanTimeZone": "+03:00"
            },
            {
                "ReferenceID": 10541,
                "City": "Riyadh",
                "ScanType": "OD",
                "ScanDescription": "Out for Delivery",
                "ScanDateTime": "2024-01-10T10:00:00",
                "ScanTimeZone": "+03:00"
            },
            {
                "ReferenceID": 10354,
                "City": "Jeddah",
                "ScanType": "AF",
                "ScanDescription": "Arrived Delivery Facility",
                "ScanDateTime": "2024-01-10T09:00:00",
                "ScanTimeZone": "+03:00"
            }
        ]
    },
    {
        "AWB": "231200022000",
        "Reference": "REF1234567890",
        "Pieces": 1,
        "CODAmount": 0.0,
        "ContentDesc": "Shipment contents description",
        "RecipientName": "Abdulaziz",
        "OriginCity": "Jeddah",
        "OriginCountry": "SA",
        "DesinationCity": "Riyadh",
        "DesinationCountry": "SA",
        "Scans": [
            {
                "ReferenceID": 10545,
                "City": "Riyadh",
                "ScanType": "OD",
                "ScanDescription": "Out for Delivery",
                "ScanDateTime": "2024-01-10T10:00:00",
                "ScanTimeZone": "+03:00"
            },
            {
                "ReferenceID": 10360,
                "City": "Jeddah",
                "ScanType": "AF",
                "ScanDescription": "Arrived Delivery Facility",
                "ScanDateTime": "2024-01-10T09:00:00",
                "ScanTimeZone": "+03:00"
            }
        ]
    }
]`;

const webhookQuerySample = `GET /api/scans?key={API_Key}&referenceId={?reference}
Host: webhook.smsaexpress.com

Ex: /api/scans?key=xxxx&referenceId=xxxx
Or: /api/scans?key=xxxx`;

const webhookQueryResponse = `[
    {
        "AWB": "231200021000",
        "Reference": "REF1234567890",
        "Pieces": 1,
        "CODAmount": 0.0,
        "ContentDesc": "Shipment contents description",
        "RecipientName": "Abdulaziz",
        "OriginCity": "Jeddah",
        "OriginCountry": "SA",
        "DesinationCity": "Riyadh",
        "DesinationCountry": "SA",
        "isDelivered": true, // Only in delivered Shipment
        "Scans": [
            {
                "ReferenceID": 10611,
                "ReceivedBy": "Abdulaziz", // Only in delivered Shipment
                "City": "Riyadh",
                "ScanType": "DL",
                "ScanDescription": "Delivered",
                "ScanDateTime": "2024-01-10T11:00:00",
                "ScanTimeZone": "+03:00"
            },
            {
                "ReferenceID": 10541,
                "City": "Riyadh",
                "ScanType": "OD",
                "ScanDescription": "Out for Delivery",
                "ScanDateTime": "2024-01-10T10:00:00",
                "ScanTimeZone": "+03:00"
            },
            {
                "ReferenceID": 10354,
                "City": "Jeddah",
                "ScanType": "AF",
                "ScanDescription": "Arrived Delivery Facility",
                "ScanDateTime": "2024-01-10T09:00:00",
                "ScanTimeZone": "+03:00"
            }
        ]
    },
    {
        "AWB": "231200022000",
        "Reference": "REF1234567890",
        "Pieces": 1,
        "CODAmount": 0.0,
        "ContentDesc": "Shipment contents description",
        "RecipientName": "Abdulaziz",
        "OriginCity": "Jeddah",
        "OriginCountry": "SA",
        "DesinationCity": "Riyadh",
        "DesinationCountry": "SA",
        "Scans": [
            {
                "ReferenceID": 10545,
                "City": "Riyadh",
                "ScanType": "OD",
                "ScanDescription": "Out for Delivery",
                "ScanDateTime": "2024-01-10T10:00:00",
                "ScanTimeZone": "+03:00"
            },
            {
                "ReferenceID": 10360,
                "City": "Jeddah",
                "ScanType": "AF",
                "ScanDescription": "Arrived Delivery Facility",
                "ScanDateTime": "2024-01-10T09:00:00",
                "ScanTimeZone": "+03:00"
            }
        ]
    }
]`;

type CodeBlockProps = {
  label?: string;
  code: string;
};

function CodeBlock({ label, code }: CodeBlockProps) {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl bg-slate-900 text-slate-200 shadow-inner shadow-black/20">
      {label && (
        <div className="border-b border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
          {label}
        </div>
      )}
      <pre className="overflow-x-auto px-4 py-4 text-xs sm:text-sm" dir="ltr">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function SmsaWebhookPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <AppNavbar
        title="تكامل ويب هوك سمسا"
        subtitle="كل ما تحتاجه لتسجيل الويب هوك وقراءة آخر عمليات المسح"
      />

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <section className="mb-10">
          <Card className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-600 via-indigo-500 to-sky-500 text-white shadow-xl shadow-indigo-200/70">
            <CardHeader className="sm:flex sm:flex-row sm:items-center sm:gap-8">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20">
                <Server className="h-8 w-8" />
              </div>
              <div>
                <CardTitle className="text-2xl font-bold">SMSA Webhook Playbook</CardTitle>
                <CardDescription className="text-indigo-100">
                  Follow these steps to get your webhook approved, receive push scans, and query the
                  latest statuses whenever you need a manual refresh.
                </CardDescription>
              </div>
            </CardHeader>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="rounded-3xl border border-slate-200 bg-white/95">
            <CardHeader className="flex flex-row items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                <ListChecks className="h-6 w-6" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold text-slate-900">
                  Steps for registration
                </CardTitle>
                <CardDescription className="text-slate-600">
                  Complete these actions in SMSA&apos;s partner portal before going live.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-3 pe-6 ps-8 text-sm text-slate-800" dir="ltr">
                {registrationSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <CodeBlock label="Webhook request example" code={webhookCurlSample} />
              <CodeBlock label="Payload sample" code={webhookRequestSample} />
            </CardContent>
          </Card>

          <Card className="rounded-3xl border border-slate-200 bg-white/95">
            <CardHeader className="flex flex-row items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold text-slate-900">
                  Query Webhook For Latest Scans
                </CardTitle>
                <CardDescription className="text-slate-600">
                  Use the generated API key to poll the SMSA webhook if you need to sync scans on
                  demand.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-3 pe-6 ps-8 text-sm text-slate-800" dir="ltr">
                {querySteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <CodeBlock label="Request sample" code={webhookQuerySample} />
              <CodeBlock label="Response sample" code={webhookQueryResponse} />
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
