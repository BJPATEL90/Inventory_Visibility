import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Clock3,
  Cloud,
  Database,
  FileSpreadsheet,
  Mail,
  Palette,
  RefreshCw,
  Tags
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { DashboardConfig } from '../types';

interface CalculationLogicPageProps {
  config?: DashboardConfig;
}

const numberFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2
});

function CodeText({ children }: { children: string }) {
  return (
    <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[0.78rem] font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100">
      {children}
    </code>
  );
}

function LogicCard({
  title,
  description,
  icon,
  children
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-slate-950 dark:text-white">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function FormulaTable({
  rows
}: {
  rows: Array<{
    name: string;
    formula: string;
    explanation: string;
  }>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="min-w-[760px] w-full border-collapse text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
          <tr>
            <th className="w-48 px-4 py-3 font-bold">KPI</th>
            <th className="w-[340px] px-4 py-3 font-bold">Calculation</th>
            <th className="px-4 py-3 font-bold">How it is applied</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map((row) => (
            <tr key={row.name} className="align-top">
              <th className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                {row.name}
              </th>
              <td className="px-4 py-3">
                <CodeText>{row.formula}</CodeText>
              </td>
              <td className="px-4 py-3 leading-6 text-slate-600 dark:text-slate-300">
                {row.explanation}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function currentHourWindow(hour?: number) {
  const start = typeof hour === 'number' && Number.isFinite(hour) ? hour : 0;
  const end = (start + 1) % 24;
  const label = (value: number) =>
    new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    }).format(new Date(Date.UTC(2026, 0, 1, value - 5, -30)));

  return `${label(start)}–${label(end)} IST`;
}

export function CalculationLogicPage({
  config
}: CalculationLogicPageProps) {
  const quantityRows = [
    {
      name: 'Inventory Accuracy — Qty',
      formula: '100 − (Σ |Difference| ÷ Σ System Qty × 100)',
      explanation:
        'Difference is evaluated row by row. If total System Quantity is zero, the result is safely returned as 0%.'
    },
    {
      name: 'System Quantity',
      formula: 'Σ System Quantity',
      explanation:
        'Adds the Sys/Total quantity from every included cycle-count row.'
    },
    {
      name: 'Physical Quantity',
      formula: 'Σ Physical Quantity',
      explanation:
        'Adds Phy after NTF normalization. An NTF row is treated as Physical Quantity 0.'
    },
    {
      name: 'Absolute Variance',
      formula: 'Short Quantity + Excess Quantity',
      explanation:
        'This is the exact numerator used for Inventory Accuracy. Net Difference is shown separately and is not used for accuracy.'
    },
    {
      name: 'Net Difference',
      formula: 'Physical Quantity − System Quantity',
      explanation:
        'Calculated from the final period totals. Negative results are displayed in brackets.'
    },
    {
      name: 'Short Quantity',
      formula: 'Σ |Difference| where Difference < 0',
      explanation:
        'Only negative row differences contribute to Short Quantity.'
    },
    {
      name: 'Excess Quantity',
      formula: 'Σ Difference where Difference > 0',
      explanation:
        'Only positive row differences contribute to Excess Quantity.'
    }
  ];

  const binRows = [
    {
      name: 'Actual Bin Count',
      formula: 'Unique Facility + Rack + Shelf',
      explanation:
        'Repeated SKU or batch rows in the same Facility/Rack/Shelf combination are counted as one bin.'
    },
    {
      name: 'Bin Accuracy',
      formula: 'Accurate Bins ÷ Actual Bins × 100',
      explanation:
        'Differences are first totalled by bin. A bin is accurate only when its combined Difference equals zero.'
    },
    {
      name: 'Planned Bins — Yesterday',
      formula: 'Daily Planned Bin Count',
      explanation:
        'Uses the current Daily Planned Bin Count from Config.'
    },
    {
      name: 'Planned Bins — MTD',
      formula: 'Daily Plan × completed working days',
      explanation:
        'Monday–Saturday are working days; Sundays are excluded. Completed days are capped at the configured Working Days.'
    },
    {
      name: 'Planned Bins — Month / Quarter',
      formula: 'Daily Plan × Working Days × 1 or 3',
      explanation:
        'Last Month uses one configured month; Last Quarter uses three configured months.'
    },
    {
      name: 'Cycle Count Completion',
      formula: 'Actual Bin Count ÷ Planned Bin Count × 100',
      explanation:
        'This KPI measures completed unique bins against the planned bins for the selected reporting period.'
    }
  ];

  const valueRows = [
    {
      name: 'System / Physical Value',
      formula: 'Quantity × COGS Unit Rate',
      explanation:
        'COGS is matched by SKU, case-insensitively, using Unit Rate Excluding GST.'
    },
    {
      name: 'Short / Excess Value',
      formula: '|Difference| × COGS Unit Rate',
      explanation:
        'Negative differences feed Short Value; positive differences feed Excess Value.'
    },
    {
      name: 'Net Difference Value',
      formula: 'Physical Value − System Value',
      explanation:
        'Uses only rows that have a valid COGS rate.'
    },
    {
      name: 'Inventory Accuracy — Value',
      formula: '100 − ((Short Value + Excess Value) ÷ System Value × 100)',
      explanation:
        'Measures absolute variance at COGS level. If System Value is zero, the result is 0%.'
    },
    {
      name: 'Cost Coverage',
      formula: 'Rows with valid COGS ÷ all included rows × 100',
      explanation:
        'Rows missing COGS remain in quantity KPIs but are excluded from all value totals.'
    }
  ];

  return (
    <section id="calculation-logic" className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-950 via-blue-900 to-blue-800 p-5 text-white shadow-md shadow-blue-950/10 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">
              Reference guide
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight">
              Calculation Logic &amp; Publication
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-100">
              This page explains which data is read, how every published KPI is
              calculated, and how the dashboard and scheduled email are
              refreshed.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold ring-1 ring-white/20">
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
            Read-only documentation
          </span>
        </div>
      </div>

      <LogicCard
        title="End-to-end data flow"
        description="No physical Combine sheet is created. Apps Script joins the rows in memory."
        icon={<Cloud className="h-5 w-5" />}
      >
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              step: '01',
              title: 'Read sources',
              text: 'Read current cycle counts, historical rows, COGS, SKU class, Activity Status, and opening inventory snapshots.'
            },
            {
              step: '02',
              title: 'Clean and combine',
              text: 'Skip blank/header-only sources, normalize facilities and NTF rows, then join cost and ABC class by SKU.'
            },
            {
              step: '03',
              title: 'Calculate',
              text: 'Apply date periods, calculate quantity/value/bin KPIs, and update cumulative quantity coverage.'
            },
            {
              step: '04',
              title: 'Publish',
              text: 'Store the latest cloud snapshot, return JSON to React, and build the daily HTML email plus quarter CSV.'
            }
          ].map((item) => (
            <li
              key={item.step}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
            >
              <span className="text-xs font-black tracking-[0.18em] text-blue-600 dark:text-blue-300">
                STEP {item.step}
              </span>
              <h3 className="mt-1.5 font-bold text-slate-950 dark:text-white">
                {item.title}
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {item.text}
              </p>
            </li>
          ))}
        </ol>
      </LogicCard>

      <LogicCard
        title="Data sources"
        description="These are the current authoritative sources used by the production backend."
        icon={<Database className="h-5 w-5" />}
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-[760px] w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Purpose</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Published use</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {[
                ['Current cycle counts', 'Inventory_Dashboard: SL_AMBIENT, SL_MH, SL_RX', 'Current quantity, bin, and value KPIs'],
                ['External cycle counts', 'Bin wise cycle Count-Q2-JAS: OWN and B2C', 'OWN plus B2C facilities SL_MM, SL_LJ, and SL_BW'],
                ['Historical cycle counts', 'Inventory_Dashboard: Q1-AMJ26', 'Last Quarter and past-date reporting'],
                ['Unit cost', 'Inventory_Dashboard: COGS', 'Value KPIs at unit rate excluding GST'],
                ['SKU classification', 'Inventory_Dashboard: SKU_MASTER', 'A, B, and C drill-down; missing or invalid classes default to C'],
                ['No-activity explanation', 'Inventory_Dashboard: Activity_Status', 'Reason and remark when a reporting date has no count'],
                ['Opening GOOD inventory', 'Latest approved Unicommerce email CSV', 'Daily denominator for facility and overall quantity coverage'],
                ['Stored coverage history', 'Hidden Cycle_Coverage_System', 'Daily opening, counted, cumulative, completion, and inventory change']
              ].map(([purpose, source, use]) => (
                <tr key={purpose} className="align-top">
                  <th className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                    {purpose}
                  </th>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {source}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {use}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LogicCard>

      <LogicCard
        title="Quantity KPI formulas"
        description="Quantity accuracy is based on absolute row variance, so shortages and excesses do not cancel each other."
        icon={<Calculator className="h-5 w-5" />}
      >
        <FormulaTable rows={quantityRows} />
      </LogicCard>

      <LogicCard
        title="Bin planning and completion formulas"
        description="Bin identity and planned-bin rules are shared across the KPI cards and email."
        icon={<FileSpreadsheet className="h-5 w-5" />}
      >
        <FormulaTable rows={binRows} />
      </LogicCard>

      <LogicCard
        title="COGS and value formulas"
        description="Value KPIs use only rows that have a valid COGS match; quantity KPIs continue to include every valid inventory row."
        icon={<Tags className="h-5 w-5" />}
      >
        <FormulaTable rows={valueRows} />
      </LogicCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <LogicCard
          title="Reporting periods"
          icon={<Clock3 className="h-5 w-5" />}
        >
          <div className="space-y-3 text-sm">
            {[
              ['Last Quarter', 'Previous completed calendar quarter. For Jul–Sep 2026, this is Apr–Jun 2026 and is supplied by Q1-AMJ26.'],
              ['Last Month', 'First through last date of the previous completed calendar month. It changes automatically when the month changes.'],
              ['Month to Date', 'First date of the current month through today. Current undated NTF rows are also included in MTD.'],
              ['Yesterday', 'The previous calendar date in Asia/Kolkata time. If it has no rows, Activity_Status supplies the reason and remark.'],
              ['Date filter', 'The transaction page sends the selected start and end date to Apps Script; table rows and transaction KPI summary use that exact range.']
            ].map(([name, text]) => (
              <div
                key={name}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
              >
                <h3 className="font-bold text-slate-950 dark:text-white">
                  {name}
                </h3>
                <p className="mt-1 leading-6 text-slate-600 dark:text-slate-300">
                  {text}
                </p>
              </div>
            ))}
          </div>
        </LogicCard>

        <LogicCard
          title="Special row rules"
          icon={<AlertTriangle className="h-5 w-5" />}
        >
          <ul className="space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <strong className="text-slate-950 dark:text-white">NTF:</strong>{' '}
              if Rack, Shelf, or Remark contains “NTF”, Physical Quantity is
              forced to 0 and Difference becomes <CodeText>0 − System Qty</CodeText>.
              NTF is therefore included as a shortage; there is no separate NTF KPI.
            </li>
            <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <strong className="text-slate-950 dark:text-white">Blank Difference:</strong>{' '}
              if Diff is blank, the system calculates <CodeText>Phy − Sys</CodeText>.
              If Diff is supplied, that source value is used.
            </li>
            <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <strong className="text-slate-950 dark:text-white">ABC Class:</strong>{' '}
              SKU codes are matched case-insensitively to SKU_MASTER. Missing
              or invalid matches are assigned to C by default.
            </li>
            <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <strong className="text-slate-950 dark:text-white">Negative display:</strong>{' '}
              negative KPI quantities and values are shown in brackets, while
              the stored numeric value remains negative.
            </li>
          </ul>
        </LogicCard>
      </div>

      <LogicCard
        title="Quarter quantity coverage"
        description="This is the progress bar shown on the KPI landing page and the facility progress page."
        icon={<RefreshCw className="h-5 w-5" />}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {[
            {
              name: 'Daily opening quantity',
              formula: 'GOOD_INVENTORY Quantity from the emailed CSV',
              text: 'Only the approved facilities and the CSV Quantity column are used. BAD and QC Rejected quantities are stored for audit but excluded from completion.'
            },
            {
              name: 'Daily counted quantity',
              formula: 'Σ max(0, System Qty) for cycle-count rows dated that day',
              text: 'Calculated separately for SL_AMBIENT, SL_MH, SL_RX, SL_MM, SL_LJ, SL_BW, and OWN.'
            },
            {
              name: 'Cumulative counted quantity',
              formula: 'Σ Daily Counted Qty from cycle start through snapshot date',
              text: 'The numerator grows as newly dated cycle-count rows are added during the configured quarter.'
            },
            {
              name: 'Quantity coverage',
              formula: 'Cumulative Counted Qty ÷ snapshot-day GOOD Qty × 100',
              text: 'The denominator uses that day’s opening GOOD inventory, so the percentage can change when the opening inventory changes.'
            },
            {
              name: 'ABC completed contribution',
              formula: 'Class Cumulative Counted Qty / Total Opening GOOD Qty x 100',
              text: 'A, B, and C completed contributions reconcile to the overall quantity coverage shown in the main banner.'
            },
            {
              name: 'ABC pending contribution',
              formula: 'max(Class Opening GOOD Qty - Class Cumulative Counted Qty, 0)',
              text: 'Each class pending quantity is calculated first. Its share of total opening inventory gives the pending contribution; completed plus pending reconciles to 100%.'
            },
            {
              name: 'Inventory change',
              formula: '(Today GOOD Qty − Previous GOOD Qty) ÷ Previous GOOD Qty × 100',
              text: `An alert note is created when the absolute change reaches the Config threshold${config ? ` of ${numberFormatter.format(config.inventoryChangeAlertPercent)}%` : ''}.`
            }
          ].map((item) => (
            <div
              key={item.name}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
            >
              <h3 className="font-bold text-slate-950 dark:text-white">
                {item.name}
              </h3>
              <p className="mt-1.5">
                <CodeText>{item.formula}</CodeText>
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {item.text}
              </p>
            </div>
          ))}
        </div>
      </LogicCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <LogicCard
          title="Accuracy colour rule"
          description="One reusable rule is applied to quantity accuracy, value accuracy, bin accuracy, and email indicators."
          icon={<Palette className="h-5 w-5" />}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
              <span className="text-lg font-black text-red-700 dark:text-red-300">Red</span>
              <p className="mt-1 text-sm text-red-800 dark:text-red-200">Below 96%</p>
            </div>
            <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-900 dark:bg-yellow-950/30">
              <span className="text-lg font-black text-yellow-700 dark:text-yellow-300">Yellow</span>
              <p className="mt-1 text-sm text-yellow-800 dark:text-yellow-200">96% to below 99%</p>
            </div>
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950/30">
              <span className="text-lg font-black text-green-700 dark:text-green-300">Green</span>
              <p className="mt-1 text-sm text-green-800 dark:text-green-200">99% and above</p>
            </div>
          </div>
        </LogicCard>

        <LogicCard
          title="Current Config controls"
          description="The dashboard reads these operational values from Config; they are not hardcoded in the frontend."
          icon={<FileSpreadsheet className="h-5 w-5" />}
        >
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Daily planned bins', config ? numberFormatter.format(config.dailyPlannedBinCount) : 'From Config'],
              ['Working days', config ? numberFormatter.format(config.workingDays) : 'From Config'],
              ['Cloud refresh', config ? `Every ${config.autoRefreshMinutes} minutes` : 'From Config'],
              ['Email window', config ? currentHourWindow(config.emailSendHour) : 'From Config'],
              ['Coverage start', config?.coverageCycleStartDate || 'From Config'],
              ['Coverage months', config ? numberFormatter.format(config.coverageCycleMonths) : 'From Config'],
              ['Inventory import', config ? `Every ${config.inventoryImportMinutes} minutes` : 'From Config'],
              ['Change alert', config ? `${numberFormatter.format(config.inventoryChangeAlertPercent)}%` : 'From Config']
            ].map(([name, value]) => (
              <div
                key={name}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950"
              >
                <dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {name}
                </dt>
                <dd className="mt-1 font-bold text-slate-950 dark:text-white">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </LogicCard>
      </div>

      <LogicCard
        title="Refresh and publication rules"
        description="Scheduled operations run in Google Apps Script, so they continue when the laptop is switched off."
        icon={<Mail className="h-5 w-5" />}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              title: 'Manual dashboard refresh',
              text: 'The Refresh button asks Apps Script to reread both cycle-count workbooks, rebuild KPIs and coverage, save the latest snapshot, then reload the React data.'
            },
            {
              title: 'Automatic cloud refresh',
              text: 'The time-driven refresh trigger rebuilds the dashboard at the interval stored in Config. It does not depend on an open browser.'
            },
            {
              title: 'Daily email',
              text: 'At send time, Apps Script reads fresh source data again, reports Yesterday, includes the four period accuracy banners and coverage, and shows Activity_Status when no count exists.'
            },
            {
              title: 'Quarter CSV attachment',
              text: 'The email attaches dated transactions from the first day of the reporting date’s calendar quarter through the reporting date. Undated rows are excluded.'
            }
          ].map((item) => (
            <article
              key={item.title}
              className="rounded-lg border border-slate-200 p-4 dark:border-slate-800"
            >
              <h3 className="font-bold text-slate-950 dark:text-white">
                {item.title}
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {item.text}
              </p>
            </article>
          ))}
        </div>
      </LogicCard>

      <LogicCard
        title="Rows excluded or treated differently"
        icon={<AlertTriangle className="h-5 w-5" />}
      >
        <ul className="grid gap-2 text-sm leading-6 text-slate-600 dark:text-slate-300 md:grid-cols-2">
          {[
            'Missing, empty, and header-only inventory sheets are skipped.',
            'Completely blank inventory rows are skipped.',
            'B2C rows with a blank or unsupported Facility are skipped and logged.',
            'Undated rows are excluded from dated periods and quarter CSV, except current undated NTF rows included in MTD.',
            'Rows without COGS remain in quantity and bin KPIs but are excluded from value calculations.',
            'BAD_INVENTORY and QC_REJECTED opening quantities are stored but excluded from quantity coverage.',
            'The backend does not copy external OWN or B2C rows into Inventory_Dashboard and does not create a physical Combine sheet.',
            'A zero denominator returns 0% instead of an error.'
          ].map((item) => (
            <li
              key={item}
              className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-950"
            >
              <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </LogicCard>
    </section>
  );
}
