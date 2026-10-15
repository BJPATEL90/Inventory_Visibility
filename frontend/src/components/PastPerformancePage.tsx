import { History, RefreshCw } from 'lucide-react';
import type {
  PastPerformanceData,
  PastPerformanceQuarter
} from '../types';

interface PastPerformancePageProps {
  data?: PastPerformanceData;
  isLoading: boolean;
  errorMessage: string;
  onRetry: () => void;
}

type Metric = {
  label: string;
  group: string;
  value: (quarter: PastPerformanceQuarter) => string;
};

const number = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2
});
const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2
});

const percent = (value: number) => `${number.format(value)}%`;

const METRICS: Metric[] = [
  { label: 'Inventory Accuracy', group: 'Accuracy', value: (q) => percent(q.inventoryAccuracy) },
  { label: 'COGS Value Accuracy', group: 'Accuracy', value: (q) => percent(q.valueAccuracy) },
  { label: 'Bin Accuracy', group: 'Accuracy', value: (q) => percent(q.binAccuracy) },
  { label: 'Cycle Count Completion', group: 'Bins', value: (q) => percent(q.cycleCountCompletion) },
  { label: 'Planned Bin Count', group: 'Bins', value: (q) => number.format(q.plannedBinCount) },
  { label: 'Actual Bin Count', group: 'Bins', value: (q) => number.format(q.actualBinCount) },
  { label: 'System Quantity', group: 'Quantity', value: (q) => number.format(q.systemQuantity) },
  { label: 'Physical Quantity', group: 'Quantity', value: (q) => number.format(q.physicalQuantity) },
  { label: 'Net Difference Quantity', group: 'Quantity', value: (q) => number.format(q.netDifference) },
  { label: 'Absolute Variance Quantity', group: 'Quantity', value: (q) => number.format(q.absoluteVarianceQuantity) },
  { label: 'System Value', group: 'COGS Value', value: (q) => currency.format(q.systemValue) },
  { label: 'Physical Value', group: 'COGS Value', value: (q) => currency.format(q.physicalValue) },
  { label: 'Net Difference Value', group: 'COGS Value', value: (q) => currency.format(q.netDifferenceValue) },
  { label: 'Absolute Variance Value', group: 'COGS Value', value: (q) => currency.format(q.absoluteVarianceValue) },
  { label: 'Cost Coverage', group: 'Data Quality', value: (q) => percent(q.costCoverage) },
  { label: 'Transaction Rows', group: 'Data Quality', value: (q) => number.format(q.rowCount) }
];

export function PastPerformancePage({
  data,
  isLoading,
  errorMessage,
  onRetry
}: PastPerformancePageProps) {
  const quarters = data?.quarters || [];

  return (
    <section>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
            Historical performance
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            Past Performance
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Fiscal-quarter Executive KPIs. Closed quarters are fixed snapshots;
            the current quarter is shown quarter-to-date.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <History className="h-3.5 w-3.5 text-blue-600" />
          Stored in {data?.sheetName || 'Past_Performance_System'}
        </span>
      </div>

      {isLoading && quarters.length === 0 ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-6 py-12 text-center dark:border-blue-900 dark:bg-blue-950/30">
          <RefreshCw className="mx-auto h-9 w-9 animate-spin text-blue-600" />
          <p className="mt-3 font-semibold">Preparing quarterly KPI history…</p>
        </div>
      ) : errorMessage ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-10 text-center text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          <p>{errorMessage}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white"
          >
            Try again
          </button>
        </div>
      ) : quarters.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center dark:border-slate-800 dark:bg-slate-900">
          No quarterly KPI snapshots are available yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-950 text-white">
                  <th className="sticky left-0 z-10 min-w-56 bg-slate-950 px-5 py-4 text-left font-bold">
                    Executive KPI
                  </th>
                  {quarters.map((quarter) => (
                    <th key={quarter.quarter} className="min-w-48 px-5 py-4 text-right">
                      <span className="block font-bold">{quarter.label}</span>
                      <span className="mt-1 block text-xs font-normal text-slate-300">
                        {quarter.startDate} to {quarter.endDate}
                      </span>
                      <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        quarter.status === 'Closed'
                          ? 'bg-emerald-400/20 text-emerald-200'
                          : 'bg-amber-300/20 text-amber-100'
                      }`}>
                        {quarter.status}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((metric, index) => {
                  const startsGroup = index === 0 || METRICS[index - 1].group !== metric.group;
                  return (
                    <tr key={metric.label} className={`border-t border-slate-200 dark:border-slate-800 ${startsGroup ? 'border-t-2' : ''}`}>
                      <th className="sticky left-0 z-10 bg-white px-5 py-3 text-left dark:bg-slate-900">
                        {startsGroup ? (
                          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-300">
                            {metric.group}
                          </span>
                        ) : null}
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {metric.label}
                        </span>
                      </th>
                      {quarters.map((quarter) => (
                        <td key={quarter.quarter} className="px-5 py-3 text-right font-bold tabular-nums text-slate-900 dark:text-white">
                          {metric.value(quarter)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
