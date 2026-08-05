import {
  AlertCircle,
  CalendarDays,
  PackageCheck,
  RefreshCw,
  Target
} from 'lucide-react';
import type {
  CoverageFacilityKey,
  CycleCoverageData
} from '../types';

const numberFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2
});

const FACILITY_LABELS: Record<CoverageFacilityKey, string> = {
  SL_AMBIENT: 'SL Ambient',
  SL_MH: 'SL Mother Hub',
  SL_RX: 'SL RX',
  SL_MM: 'SL MM',
  SL_LJ: 'SLLJ',
  SL_BW: 'SL BW',
  OWN: 'OWN'
};

function formatNumber(value: number) {
  const formatted = numberFormatter.format(Math.abs(value));
  return value < 0 ? `(${formatted})` : formatted;
}

function formatPercent(value: number) {
  return `${numberFormatter.format(value)}%`;
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

function formatMonth(value: string) {
  const date = new Date(`${value}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function progressWidth(value: number) {
  return `${Math.min(100, Math.max(0, value))}%`;
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div
      className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <span
        className="block h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 transition-[width] duration-500"
        style={{ width: progressWidth(value) }}
      />
    </div>
  );
}

function EmptyCoverage({ setupRequired }: { setupRequired: boolean }) {
  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 px-6 py-12 text-center shadow-sm dark:border-amber-900 dark:bg-amber-950/30">
      <AlertCircle className="mx-auto h-11 w-11 text-amber-600" />
      <h2 className="mt-4 text-xl font-bold text-amber-950 dark:text-amber-100">
        Cycle coverage is waiting for its first inventory import
      </h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-amber-800 dark:text-amber-300">
        {setupRequired
          ? 'Run setupApplication() once in Apps Script, then run importLatestInventoryEmail().'
          : 'Run importLatestInventoryEmail() or wait for the cloud import trigger to process the next successful inventory export email.'}
      </p>
    </div>
  );
}

export function CycleCoveragePage({
  data,
  isLoading,
  errorMessage,
  selectedMonth,
  onMonthChange,
  onRetry
}: {
  data?: CycleCoverageData;
  isLoading: boolean;
  errorMessage: string;
  selectedMonth: string;
  onMonthChange: (month: string) => void;
  onRetry: () => void;
}) {
  if (isLoading && !data) {
    return (
      <div className="rounded-3xl border border-blue-200 bg-blue-50 px-6 py-16 text-center dark:border-blue-900 dark:bg-blue-950/30">
        <RefreshCw className="mx-auto h-10 w-10 animate-spin text-blue-600" />
        <h2 className="mt-4 text-lg font-bold">Loading facility progress</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Reading the latest MTD inventory snapshot.
        </p>
      </div>
    );
  }

  if (errorMessage && !data) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 px-6 py-12 text-center dark:border-red-900 dark:bg-red-950/30">
        <AlertCircle className="mx-auto h-10 w-10 text-red-600" />
        <h2 className="mt-4 text-lg font-bold text-red-950 dark:text-red-100">
          Facility progress could not be loaded
        </h2>
        <p className="mt-2 text-sm text-red-800 dark:text-red-300">
          {errorMessage}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data || data.rows.length === 0 || !data.latest) {
    return <EmptyCoverage setupRequired={Boolean(data?.setupRequired)} />;
  }

  const latest = data.latest;

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
            Facility progress
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">
            MTD Inventory &amp; Cycle Count Coverage
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            GOOD inventory only · Cycle {formatDate(data.cycleStartDate)} to{' '}
            {formatDate(data.cycleEndDate)}
          </p>
        </div>
        <label className="w-full max-w-xs text-sm font-semibold text-slate-700 dark:text-slate-200">
          Reporting month
          <select
            value={selectedMonth || data.selectedMonth}
            onChange={(event) => onMonthChange(event.target.value)}
            className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          >
            {data.availableMonths.map((month) => (
              <option key={month} value={month}>
                {formatMonth(month)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {errorMessage ? (
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          Latest refresh failed. Showing the last successful facility snapshot.
        </div>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-3xl bg-gradient-to-r from-blue-950 via-blue-900 to-blue-800 p-6 text-white shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-200">
              Overall quantity coverage
            </p>
            <p className="mt-2 text-5xl font-black tracking-tight">
              {formatPercent(latest.totalCompletionPercent)}
            </p>
            <p className="mt-2 text-sm text-blue-200">
              As of {formatDate(latest.date)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15">
              <p className="text-xs text-blue-200">Opening GOOD Qty</p>
              <p className="mt-1 text-lg font-black">
                {formatNumber(latest.totalGoodQuantity)}
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15">
              <p className="text-xs text-blue-200">Cumulative Counted</p>
              <p className="mt-1 text-lg font-black">
                {formatNumber(latest.totalCumulativeCountedQuantity)}
              </p>
            </div>
            <div className="col-span-2 rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15 sm:col-span-1">
              <p className="text-xs text-blue-200">Counted Today</p>
              <p className="mt-1 text-lg font-black">
                {formatNumber(latest.totalDailyCountedQuantity)}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-6 h-3 overflow-hidden rounded-full bg-white/15">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-[width] duration-500"
            style={{ width: progressWidth(latest.totalCompletionPercent) }}
          />
        </div>
      </section>

      {latest.alertNote ? (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-950 shadow-sm dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p>{latest.alertNote}</p>
        </div>
      ) : null}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.facilities.map((facility) => {
          const metrics = latest.facilities[facility];
          return (
            <article
              key={facility}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {FACILITY_LABELS[facility]}
                  </p>
                  <p className="mt-2 text-3xl font-black text-blue-700 dark:text-blue-300">
                    {formatPercent(metrics.completionPercent)}
                  </p>
                </div>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  <Target className="h-5 w-5" />
                </span>
              </div>
              <div className="mt-4">
                <ProgressBar value={metrics.completionPercent} />
              </div>
              <dl className="mt-4 space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Opening GOOD Qty</dt>
                  <dd className="font-bold">
                    {formatNumber(metrics.goodQuantity)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Cumulative Counted</dt>
                  <dd className="font-bold">
                    {formatNumber(metrics.cumulativeCountedQuantity)}
                  </dd>
                </div>
              </dl>
            </article>
          );
        })}
      </section>

      <section className="mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            <CalendarDays className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-black">Day-wise MTD coverage</h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Every facility cell shows cumulative counted quantity / opening GOOD quantity and completion percentage.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full whitespace-nowrap text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-right">Total Qty</th>
                <th className="px-4 py-3 text-right">Total Counted</th>
                <th className="px-4 py-3 text-right">Completion</th>
                {data.facilities.map((facility) => (
                  <th key={facility} className="px-4 py-3 text-right">
                    {FACILITY_LABELS[facility]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {[...data.rows].reverse().map((row) => (
                <tr key={row.date}>
                  <td className="px-4 py-3 font-semibold">
                    {formatDate(row.date)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatNumber(row.totalGoodQuantity)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatNumber(row.totalCumulativeCountedQuantity)}
                  </td>
                  <td className="px-4 py-3 text-right font-black text-blue-700 dark:text-blue-300">
                    {formatPercent(row.totalCompletionPercent)}
                  </td>
                  {data.facilities.map((facility) => {
                    const metrics = row.facilities[facility];
                    return (
                      <td key={facility} className="px-4 py-3 text-right">
                        <span className="font-semibold">
                          {formatNumber(metrics.cumulativeCountedQuantity)} /{' '}
                          {formatNumber(metrics.goodQuantity)}
                        </span>
                        <span className="ml-2 text-xs font-bold text-blue-700 dark:text-blue-300">
                          {formatPercent(metrics.completionPercent)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <PackageCheck className="h-4 w-4" />
        BAD_INVENTORY and QC_REJECTED quantities are stored for audit but excluded from all completion percentages shown here.
      </p>
    </div>
  );
}
