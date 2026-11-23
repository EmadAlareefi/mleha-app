import { HelpButton, STORE_URL } from '@/components/returns/flow/ui';

/** Shown for a broken, expired or mistyped status link (and any notFound() under /returns). */
export default function ReturnsNotFound() {
  return (
    <div className="pad">
      <h1>الرابط غير صالح</h1>
      <p className="lead">لم نتمكن من فتح هذه الصفحة. ربما الرابط ناقص أو منتهي الصلاحية.</p>
      <div className="card">
        <div className="sect">ماذا يمكنك فعله؟</div>
        <p className="lead" style={{ margin: '8px 0 0' }}>
          افتحي الرابط من آخر رسالة وصلتك منا على واتساب، أو ابحثي عن طلبك برقم الطلب ورقم الجوال.
        </p>
      </div>
      <a className="btn" href="/returns">
        البحث عن طلبي
      </a>
      <HelpButton />
      <a className="link" href={STORE_URL}>
        العودة إلى المتجر
      </a>
    </div>
  );
}
