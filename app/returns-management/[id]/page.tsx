import { RequestDetailPage } from '../components/request-detail-page';

/**
 * The full page of one return request. Same body, actions and dialogs as the
 * list's detail sheet; data comes from /api/returns/list?id= (no live Salla or
 * carrier calls on load).
 */
export default async function ReturnRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequestDetailPage id={id} />;
}
