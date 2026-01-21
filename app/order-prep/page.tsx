export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import AppNavbar from '@/components/AppNavbar';
import OrderPrepClient from './OrderPrepClient';

export default function OrderPrepPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppNavbar />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <OrderPrepClient />
      </main>
    </div>
  );
}
