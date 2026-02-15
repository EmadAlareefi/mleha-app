export const dynamic = 'force-dynamic';
export const revalidate = 0;

import AppNavbar from '@/components/AppNavbar';
import MissingItemsClient from './MissingItemsClient';

export default function OrderShortagesPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppNavbar />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <MissingItemsClient />
      </main>
    </div>
  );
}
