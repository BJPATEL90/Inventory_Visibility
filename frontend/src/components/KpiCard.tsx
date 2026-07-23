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
  description: string;
  icon: LucideIcon;
  tone?: CardTone;
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
  description,
  icon: Icon,
  tone = 'blue'
}: KpiCardProps) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-2 truncate text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
            {value}
          </p>
        </div>
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${toneClasses[tone]}`}
        >
          <Icon aria-hidden="true" className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
        {description}
      </p>
    </article>
  );
}
