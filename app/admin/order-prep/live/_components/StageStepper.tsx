import { cn } from '@/lib/utils';
import { ORDER_STAGES, RETURN_STAGES, STAGE_LABELS } from './labels';

type Props = {
  kind: 'order' | 'return';
  reached: string[];
  /** The step the order is waiting on; drawn red when stuck. */
  current: string;
  stuck: boolean;
  compact?: boolean;
};

/** Placed → prep → packed → waybill → printed → exit scan → shipped, with the stuck step pulsing. */
export function StageStepper({ kind, reached, current, stuck, compact }: Props) {
  const stages = kind === 'return' ? RETURN_STAGES : ORDER_STAGES;
  const done = new Set(reached);
  return (
    <ol className="flex w-full items-start" aria-label="مسار الطلب">
      {stages.map((stage, index) => {
        const isDone = done.has(stage);
        const isCurrent = !isDone && stage === current;
        const lineDone = index > 0 && isDone;
        return (
          <li key={stage} className="relative flex flex-1 flex-col items-center">
            {index > 0 && (
              <span
                aria-hidden
                className={cn(
                  'absolute top-[9px] left-1/2 h-0.5 w-full',
                  lineDone ? 'bg-emerald-500' : isCurrent && stuck ? 'bg-gradient-to-l from-emerald-500 to-rose-400' : 'bg-stone-200',
                )}
              />
            )}
            <span
              className={cn(
                'relative z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-bold',
                isDone && 'border-emerald-500 bg-emerald-500 text-white',
                isCurrent && stuck && 'border-rose-500 bg-white text-rose-600',
                isCurrent && !stuck && 'border-amber-400 bg-white text-amber-600',
                !isDone && !isCurrent && 'border-stone-300 bg-white',
              )}
            >
              {isDone ? '✓' : isCurrent ? '!' : ''}
              {isCurrent && stuck && <span className="absolute inset-0 animate-ping rounded-full bg-rose-400/50" />}
            </span>
            <span
              className={cn(
                'mt-1 text-center text-[10px] leading-tight sm:text-[11px]',
                isCurrent ? (stuck ? 'font-bold text-rose-700' : 'font-bold text-amber-700') : isDone ? 'text-emerald-800' : 'text-stone-400',
                compact && !isCurrent && 'hidden sm:block',
              )}
            >
              {STAGE_LABELS[stage]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
