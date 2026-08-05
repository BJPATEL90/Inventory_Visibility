import type { LucideIcon } from 'lucide-react';

type CardTone =
  | 'blue'
  | 'green'
  | 'yellow'
  | 'red'
  | 'purple'
  | 'orange';

interface KpiCardProps {
  label: string;
  value: string;
  secondaryValue?: string;
  secondaryLabel?: string;
  description: string;
  icon: LucideIcon;
  tone?: CardTone;
  notice?: {
    label: string;
    value: string;
    description?: string;
  };
}

const toneClasses: Record<CardTone, string> = {
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
  green:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  yellow:
    'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300',
  purple:
    'bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  orange:
    'bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300'
};

export function KpiCard({
  label,
  value,
  secondaryValue,
  secondaryLabel,
  description,
  icon: Icon,
  tone = 'blue',
  notice
}: KpiCardProps) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-1.5 text-xl font-bold tracking-tight text-slate-950 dark:text-white">
            {value}
          </p>
          {secondaryValue ? (
            <p className="mt-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
              {secondaryLabel ? `${secondaryLabel}: ` : ''}
              {secondaryValue}
            </p>
          ) : null}
        </div>
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneClasses[tone]}`}
        >
          <Icon aria-hidden="true" className="h-4.5 w-4.5" />
        </span>
      </div>
      <p className="mt-3 text-xs leading-4 text-slate-500 dark:text-slate-400">
        {description}
      </p>
      {notice ? (
        <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 dark:border-orange-900 dark:bg-orange-950/40">
          <p className="text-xs font-bold uppercase tracking-wide text-orange-700 dark:text-orange-300">
            {notice.label}
          </p>
          <p className="mt-1 text-sm font-bold text-orange-950 dark:text-orange-100">
            {notice.value}
          </p>
          {notice.description ? (
            <p className="mt-1 text-xs leading-4 text-orange-700 dark:text-orange-300">
              {notice.description}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
