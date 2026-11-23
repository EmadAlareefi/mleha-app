import Link from 'next/link';

export const metadata = { title: 'الصفحة غير موجودة', robots: { index: false } };

/**
 * Any path no route serves. Mostly customers with a mistyped or cut-off link,
 * so it points them to the returns page and the store, never to staff login.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f3ee] px-4 py-10 text-[#2b2320]">
      <div className="w-full max-w-md rounded-2xl border border-[#e8dfd6] bg-white p-6 text-center shadow-sm">
        <h1 className="text-2xl font-bold">الصفحة غير موجودة</h1>
        <p className="mt-3 text-sm leading-7 text-[#6b5d55]">
          لم نجد هذه الصفحة. ربما الرابط ناقص أو فيه خطأ في الكتابة.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/returns"
            className="rounded-xl bg-[#8c3b2e] px-4 py-3 text-sm font-bold text-white hover:bg-[#7a3328]"
          >
            الاستبدال والاسترجاع
          </Link>
          <a
            href="https://mleha.com/ar"
            className="rounded-xl border border-[#e8dfd6] px-4 py-3 text-sm font-bold text-[#2b2320] hover:bg-[#f7f3ee]"
          >
            العودة إلى المتجر
          </a>
        </div>
      </div>
    </main>
  );
}
