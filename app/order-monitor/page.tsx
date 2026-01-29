export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import OrderMonitorClient from './OrderMonitorClient';

export default function OrderMonitorPage() {
  return <OrderMonitorClient />;
}
