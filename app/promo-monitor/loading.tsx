export default function PromoMonitorLoading() {
  return (
    <div dir="rtl" className="flex flex-1 flex-col gap-6 p-4 md:p-6" aria-busy="true">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-muted/50" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-[104px] animate-pulse rounded-xl border bg-muted/40" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
    </div>
  );
}
