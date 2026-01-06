export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import OrderPrepPage from './OrderPrepClient';

export default function OrderPrepPageWrapper() {
  return <OrderPrepPage />;
}
