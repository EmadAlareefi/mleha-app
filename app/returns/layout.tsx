import type { Metadata } from 'next';
import { ReturnsShell } from '@/components/returns/flow/ui';
import './returns-flow.css';

export const metadata: Metadata = { title: 'مليحة · طلب إرجاع أو استبدال', robots: { index: false } };

export default function ReturnsLayout({ children }: { children: React.ReactNode }) {
  return <ReturnsShell>{children}</ReturnsShell>;
}
