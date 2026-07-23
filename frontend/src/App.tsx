import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgePercent,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Gauge,
  IndianRupee,
  Moon,
  PackageCheck,
  RefreshCw,
  Scale,
  Sun,
  Target,
  Warehouse,
  WalletCards
} from 'lucide-react';
import {
  getActivityStatus,
  getBinMaster,
  getConfig,
  getDashboard,
  getSkuMaster,
  getTransactions
} from './api';
import { FilterBar } from './components/FilterBar';
import { DashboardChart } from './components/DashboardChart';
import { InventoryTable } from './components/InventoryTable';
import { KpiCard } from './components/KpiCard';
import {
  MasterTable,
  type MasterColumn
} from './components/MasterTable';
import {
  calculateCharts,
  calculateFilteredKpis,
  EMPTY_FILTERS,
  filterTransactions,
  getFilterOptions,
  hasActiveFilters,
  hasDimensionFilters
} from './dashboardUtils';
import type {
  BinMasterRow,
  DashboardFilters,
  Kpis,
  PeriodKey,
  SkuMasterRow
} from './types';

const PERIOD_KEYS: PeriodKey[] = [
  'lastMonth',
  'monthToDate',
  'yesterday'
];

const BIN_MASTER_COLUMNS: MasterColumn<BinMasterRow>[] = [
  { key: 'facility', label: 'Facility' },
  { key: 'rack', label: 'Rack' },
  { key: 'bin', label: 'Bin' },
  { key: 'status', label: 'Status' }
];

const SKU_MASTER_COLUMNS: MasterColumn<SkuMasterRow>[] = [
  { key: 'sku', label: 'SKU' },
  {
    key: 'itemName',
    label: 'Item Name',
    className: 'min-w-72 whitespace-normal'
  },
  { key: 'brand', label: 'Brand' },
  { key: 'category', label: 'Category' },
  { key: 'packSize', label: 'Pack Size', numeric: true }
];

const numberFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2
});

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2
});

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatPercent(value: number) {
  return `${numberFormatter.format(value)}%`;
}

function formatRefreshTime(value?: string) {
  if (!value) {
    return 'Not refreshed yet';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata'
  }).format(date);
}

function accuracyTone(name: string) {
  if (name === 'Green') return 'green' as const;
  if (name === 'Yellow') return 'yellow' as const;
  return 'red' as const;
}

function costCoverageTone(value: number) {
  if (value >= 100) return 'green' as const;
  if (value >= 95) return 'yellow' as const;
  return 'red' as const;
}

function DashboardHeader({
  title,
  lastRefreshTime,
  isRefreshing,
  darkMode,
  onRefresh,
  onToggleTheme
}: {
  title: string;
  lastRefreshTime?: string;
  isRefreshing: boolean;
  darkMode: boolean;
  onRefresh: () => void;
  onToggleTheme: () => void;
}) {
  return (
    <header className="border-b border-blue-800 bg-gradient-to-r from-blue-950 via-blue-900 to-blue-800 text-white">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
            <Warehouse aria-hidden="true" className="h-6 w-6" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">
              Inventory visibility
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {title}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-xl bg-white/10 px-4 py-2 ring-1 ring-white/15">
            <p className="text-xs text-blue-200">Last refresh</p>
            <p className="mt-0.5 text-sm font-semibold">
              {formatRefreshTime(lastRefreshTime)}
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-blue-900 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:cursor-wait disabled:opacity-70"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            {isRefreshing ? 'Refreshing' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={darkMode ? 'Use light mode' : 'Use dark mode'}
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/60"
          >
            {darkMode ? (
              <Sun aria-hidden="true" className="h-5 w-5" />
            ) : (
              <Moon aria-hidden="true" className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-[55vh] items-center justify-center px-4">
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          <RefreshCw aria-hidden="true" className="h-6 w-6 animate-spin" />
        </span>
        <h2 className="mt-5 text-lg font-semibold text-slate-900 dark:text-white">
          Loading inventory dashboard
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Reading the latest data from Google Sheets.
        </p>
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[55vh] max-w-2xl items-center px-4">
      <div className="w-full rounded-2xl border border-red-200 bg-red-50 p-6 text-center shadow-sm dark:border-red-900 dark:bg-red-950/40">
        <AlertCircle
          aria-hidden="true"
          className="mx-auto h-10 w-10 text-red-600 dark:text-red-400"
        />
        <h2 className="mt-4 text-lg font-semibold text-red-950 dark:text-red-100">
          Dashboard data could not be loaded
        </h2>
        <p className="mt-2 text-sm leading-6 text-red-800 dark:text-red-300">
          {message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-500/40"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function KpiGrid({ kpis }: { kpis: Kpis }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <KpiCard
        label="Inventory Accuracy"
        value={formatPercent(kpis.inventoryAccuracy)}
        description="Accuracy based on total absolute quantity difference."
        icon={Gauge}
        tone={accuracyTone(kpis.inventoryAccuracyStyle.name)}
      />
      <KpiCard
        label="Bin Accuracy"
        value={formatPercent(kpis.binAccuracy)}
        description="Accurate Facility + Rack + Shelf combinations."
        icon={CheckCircle2}
        tone={accuracyTone(kpis.binAccuracyStyle.name)}
      />
      <KpiCard
        label="System Quantity"
        value={formatNumber(kpis.systemQuantity)}
        description="Total quantity recorded by the inventory system."
        icon={Database}
        tone="blue"
      />
      <KpiCard
        label="Physical Quantity"
        value={formatNumber(kpis.physicalQuantity)}
        description="Total quantity physically counted."
        icon={Boxes}
        tone="purple"
      />
      <KpiCard
        label="Net Difference"
        value={formatNumber(kpis.netDifference)}
        description="Physical quantity minus system quantity."
        icon={Scale}
        tone={kpis.netDifference < 0 ? 'red' : 'blue'}
      />
      <KpiCard
        label="Short Quantity"
        value={formatNumber(kpis.shortQuantity)}
        description="Absolute quantity from negative differences."
        icon={ArrowDownToLine}
        tone="red"
      />
      <KpiCard
        label="Excess Quantity"
        value={formatNumber(kpis.excessQuantity)}
        description="Quantity from positive differences."
        icon={ArrowUpFromLine}
        tone="yellow"
      />
      <KpiCard
        label="Total Inventory Value"
        value={formatCurrency(kpis.totalInventoryValue)}
        description="System quantity multiplied by COGS unit rate, excluding GST."
        icon={IndianRupee}
        tone="green"
      />
      <KpiCard
        label="Physical Inventory Value"
        value={formatCurrency(kpis.physicalValue)}
        description="Physical quantity multiplied by COGS unit rate, excluding GST."
        icon={WalletCards}
        tone="purple"
      />
      <KpiCard
        label="Net Difference Value"
        value={formatCurrency(kpis.netDifferenceValue)}
        description="Physical inventory value minus total system inventory value."
        icon={Scale}
        tone={kpis.netDifferenceValue < 0 ? 'red' : 'blue'}
      />
      <KpiCard
        label="Short Value"
        value={formatCurrency(kpis.shortValue)}
        description="Absolute negative differences multiplied by COGS unit rate."
        icon={ArrowDownToLine}
        tone="red"
      />
      <KpiCard
        label="Excess Value"
        value={formatCurrency(kpis.excessValue)}
        description="Positive differences multiplied by COGS unit rate."
        icon={ArrowUpFromLine}
        tone="yellow"
      />
      <KpiCard
        label="Cost Coverage"
        value={formatPercent(kpis.costCoverage)}
        description={`${formatNumber(kpis.costedRowCount)} of ${formatNumber(
          kpis.costedRowCount + kpis.missingCostRowCount
        )} rows matched; ${formatNumber(
          kpis.missingCostSkuCount
        )} SKU(s) need a COGS rate.`}
        icon={BadgePercent}
        tone={costCoverageTone(kpis.costCoverage)}
      />
      <KpiCard
        label="Planned Bin Count"
        value={formatNumber(kpis.plannedBinCount)}
        description="Planned count calculated from the Config sheet."
        icon={Target}
        tone="blue"
      />
      <KpiCard
        label="Actual Bin Count"
        value={formatNumber(kpis.actualBinCount)}
        description="Unique Facility + Rack + Shelf combinations counted."
        icon={PackageCheck}
        tone="green"
      />
      <KpiCard
        label="Cycle Count Completion"
        value={formatPercent(kpis.cycleCountCompletion)}
        description="Actual bins divided by planned bins."
        icon={ClipboardCheck}
        tone="purple"
      />
      <KpiCard
        label="NTF Count"
        value={formatNumber(kpis.ntfCount)}
        description="Rows where the remark contains NTF."
        icon={Activity}
        tone="orange"
      />
    </div>
  );
}

export default function App() {
  const [selectedPeriod, setSelectedPeriod] =
    useState<PeriodKey>('monthToDate');
  const [filters, setFilters] =
    useState<DashboardFilters>({ ...EMPTY_FILTERS });
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('inventory-theme') === 'dark';
  });
  const [themeInitialized, setThemeInitialized] = useState(() => {
    return localStorage.getItem('inventory-theme') !== null;
  });

  const configQuery = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: 5 * 60 * 1000,
    retry: 1
  });

  const refreshInterval = configQuery.data?.data.autoRefreshMinutes
    ? configQuery.data.data.autoRefreshMinutes * 60 * 1000
    : false;

  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
    refetchInterval: refreshInterval,
    retry: 1
  });

  const transactionsQuery = useQuery({
    queryKey: ['transactions'],
    queryFn: getTransactions,
    refetchInterval: refreshInterval,
    retry: 1
  });

  const binMasterQuery = useQuery({
    queryKey: ['binMaster'],
    queryFn: getBinMaster,
    refetchInterval: refreshInterval,
    retry: 1
  });

  const skuMasterQuery = useQuery({
    queryKey: ['skuMaster'],
    queryFn: getSkuMaster,
    refetchInterval: refreshInterval,
    retry: 1
  });

  const dashboard = dashboardQuery.data?.data;
  const config = configQuery.data?.data;
  const transactions = transactionsQuery.data?.data || [];
  const binMaster = binMasterQuery.data?.data || [];
  const skuMaster = skuMasterQuery.data?.data || [];
  const period = dashboard?.periods[selectedPeriod];
  const filtersAreActive = hasActiveFilters(filters);
  const dimensionFiltersAreActive = hasDimensionFilters(filters);

  const filterOptions = useMemo(
    () => getFilterOptions(transactions),
    [transactions]
  );

  const filteredRows = useMemo(() => {
    if (!period) {
      return [];
    }

    return filterTransactions(
      transactions,
      filters,
      period.startDate,
      period.endDate
    );
  }, [filters, period, transactions]);

  const visibleKpis = useMemo(() => {
    if (!period || !config) {
      return null;
    }

    if (!filtersAreActive) {
      return period.kpis;
    }

    const plannedBins = filters.date
      ? config.dailyPlannedBinCount
      : period.kpis.plannedBinCount;

    return calculateFilteredKpis(filteredRows, plannedBins);
  }, [config, filteredRows, filters.date, filtersAreActive, period]);

  const chartData = useMemo(
    () => calculateCharts(filteredRows),
    [filteredRows]
  );

  const activityQuery = useQuery({
    queryKey: ['activityStatus', filters.date],
    queryFn: () => getActivityStatus(filters.date),
    enabled:
      Boolean(filters.date) &&
      filteredRows.length === 0 &&
      !dimensionFiltersAreActive,
    retry: 1
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    if (themeInitialized) {
      localStorage.setItem(
        'inventory-theme',
        darkMode ? 'dark' : 'light'
      );
    }
  }, [darkMode, themeInitialized]);

  useEffect(() => {
    if (config && !themeInitialized) {
      setDarkMode(config.theme.toLowerCase() === 'dark');
      setThemeInitialized(true);
    }
  }, [config, themeInitialized]);

  const isLoading =
    configQuery.isLoading ||
    dashboardQuery.isLoading ||
    transactionsQuery.isLoading ||
    binMasterQuery.isLoading ||
    skuMasterQuery.isLoading;
  const error =
    configQuery.error ||
    dashboardQuery.error ||
    transactionsQuery.error ||
    binMasterQuery.error ||
    skuMasterQuery.error;
  const isRefreshing =
    configQuery.isFetching ||
    dashboardQuery.isFetching ||
    transactionsQuery.isFetching ||
    binMasterQuery.isFetching ||
    skuMasterQuery.isFetching;

  function retryAll() {
    void Promise.all([
      configQuery.refetch(),
      dashboardQuery.refetch(),
      transactionsQuery.refetch(),
      binMasterQuery.refetch(),
      skuMasterQuery.refetch()
    ]);
  }

  function updateFilter(
    name: keyof DashboardFilters,
    value: string
  ) {
    setFilters((current) => ({
      ...current,
      [name]: value
    }));
  }

  function choosePeriod(periodKey: PeriodKey) {
    setSelectedPeriod(periodKey);
    setFilters((current) => ({
      ...current,
      date: ''
    }));
  }

  const title =
    config?.dashboardName ||
    dashboard?.dashboardName ||
    'Inventory Health Dashboard';
  const lastRefreshTime =
    dashboardQuery.data?.lastRefreshTime ||
    transactionsQuery.data?.lastRefreshTime;

  let emptyTitle = 'No inventory data found';
  let emptyMessage =
    'There are no inventory rows for this reporting period.';

  if (dimensionFiltersAreActive) {
    emptyTitle = 'No rows match the selected filters';
    emptyMessage = 'Clear one or more filters and try again.';
  } else if (filters.date) {
    const status = activityQuery.data?.data[0];
    emptyMessage = status
      ? `Reason: ${status.reason}${
          status.remark ? ` — ${status.remark}` : ''
        }`
      : 'No cycle count was performed and no Activity_Status reason was entered.';
  } else if (period?.zeroActivity) {
    emptyMessage = period.zeroActivity.reason
      ? `Reason: ${period.zeroActivity.reason}${
          period.zeroActivity.remark
            ? ` — ${period.zeroActivity.remark}`
            : ''
        }`
      : period.zeroActivity.message;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <DashboardHeader
        title={title}
        lastRefreshTime={lastRefreshTime}
        isRefreshing={isRefreshing}
        darkMode={darkMode}
        onRefresh={retryAll}
        onToggleTheme={() => {
          setThemeInitialized(true);
          setDarkMode((current) => !current);
        }}
      />

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState
          message={
            error instanceof Error
              ? error.message
              : 'An unexpected error occurred.'
          }
          onRetry={retryAll}
        />
      ) : !dashboard || !config ? (
        <ErrorState
          message="The API response did not include dashboard configuration."
          onRetry={retryAll}
        />
      ) : transactions.length === 0 ? (
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <Database className="mx-auto h-12 w-12 text-slate-400" />
          <h2 className="mt-4 text-xl font-semibold">
            No combined inventory data
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Add inventory rows to one of the five source sheets, then refresh.
          </p>
        </div>
      ) : (
        <>
          <section className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
                  <CalendarDays className="h-4 w-4" />
                  Reporting period
                </div>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Selecting a specific Date in the filter bar overrides this
                  period.
                </p>
              </div>

              <div className="inline-flex w-full rounded-xl bg-slate-100 p-1 dark:bg-slate-800 lg:w-auto">
                {PERIOD_KEYS.map((periodKey) => {
                  const isSelected = selectedPeriod === periodKey;
                  return (
                    <button
                      key={periodKey}
                      type="button"
                      onClick={() => choosePeriod(periodKey)}
                      className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition lg:flex-none ${
                        isSelected
                          ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-950 dark:text-blue-300'
                          : 'text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'
                      }`}
                    >
                      {dashboard.periods[periodKey].label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <FilterBar
            filters={filters}
            options={filterOptions}
            onChange={updateFilter}
            onClear={() => setFilters({ ...EMPTY_FILTERS })}
          />

          <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                  {filters.date
                    ? `Selected date: ${filters.date}`
                    : period?.label}
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">
                  Executive KPI
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {filtersAreActive
                    ? `${formatNumber(filteredRows.length)} matching rows`
                    : `${formatNumber(period?.rowCount || 0)} rows in this period`}
                </p>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <Database className="h-3.5 w-3.5 text-blue-600" />
                {formatNumber(dashboard.sourceSummary.combinedRowCount)} combined
                rows
              </span>
            </div>

            {filteredRows.length === 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-10 text-center shadow-sm dark:border-amber-900 dark:bg-amber-950/30">
                <AlertCircle className="mx-auto h-10 w-10 text-amber-600 dark:text-amber-400" />
                <h3 className="mt-4 text-lg font-semibold text-amber-950 dark:text-amber-100">
                  {emptyTitle}
                </h3>
                <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-amber-800 dark:text-amber-300">
                  {activityQuery.isLoading
                    ? 'Checking Activity_Status...'
                    : emptyMessage}
                </p>
              </div>
            ) : visibleKpis ? (
              <>
                <KpiGrid kpis={visibleKpis} />

                <section className="mt-10">
                  <div className="mb-5">
                    <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                      Inventory performance
                    </p>
                    <h2 className="mt-1 text-2xl font-bold tracking-tight">
                      Dashboard Charts
                    </h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      All charts follow the selected reporting period and
                      dashboard filters.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                    <DashboardChart
                      title="Inventory Accuracy Trend"
                      subtitle="Daily inventory accuracy for the current selection."
                      seriesName="Inventory Accuracy"
                      categories={
                        chartData.inventoryAccuracyTrend.categories
                      }
                      values={chartData.inventoryAccuracyTrend.values}
                      pointColors={
                        chartData.inventoryAccuracyTrend.pointColors
                      }
                      type="line"
                      unit="percent"
                      darkMode={darkMode}
                      color="#2563eb"
                    />
                    <DashboardChart
                      title="Bin Accuracy Trend"
                      subtitle="Daily accurate-bin percentage for the current selection."
                      seriesName="Bin Accuracy"
                      categories={chartData.binAccuracyTrend.categories}
                      values={chartData.binAccuracyTrend.values}
                      type="line"
                      unit="percent"
                      darkMode={darkMode}
                      color="#7c3aed"
                    />
                    <DashboardChart
                      title="Facility-Wise Inventory Accuracy"
                      subtitle="Inventory accuracy comparison across facilities."
                      seriesName="Inventory Accuracy"
                      categories={
                        chartData.facilityInventoryAccuracy.categories
                      }
                      values={
                        chartData.facilityInventoryAccuracy.values
                      }
                      pointColors={
                        chartData.facilityInventoryAccuracy.pointColors
                      }
                      type="bar"
                      unit="percent"
                      darkMode={darkMode}
                      color="#2563eb"
                    />
                    <DashboardChart
                      title="NTF Trend"
                      subtitle="Daily count of rows whose remark contains NTF."
                      seriesName="NTF Count"
                      categories={chartData.ntfTrend.categories}
                      values={chartData.ntfTrend.values}
                      type="line"
                      unit="count"
                      darkMode={darkMode}
                      color="#ea580c"
                    />
                  </div>
                </section>

                <section className="mt-10">
                  <InventoryTable rows={filteredRows} />
                </section>
              </>
            ) : null}

            <section className="mt-10">
              <div className="mb-5">
                <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                  Reference data
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">
                  Master Data
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  These tables are read-only. Update master records directly in
                  Google Sheets.
                </p>
              </div>

              <div className="space-y-6">
                <MasterTable
                  title="Bin Master"
                  description="Facility, rack, bin, and status from Bin_Master."
                  emptyMessage="Bin_Master has its header but no data rows yet."
                  rows={binMaster}
                  columns={BIN_MASTER_COLUMNS}
                />
                <MasterTable
                  title="SKU Master"
                  description="SKU reference details from SKU_MASTER."
                  emptyMessage="SKU_MASTER has no data rows."
                  rows={skuMaster}
                  columns={SKU_MASTER_COLUMNS}
                />
              </div>
            </section>
          </main>
        </>
      )}
    </div>
  );
}
