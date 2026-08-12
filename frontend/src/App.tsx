import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  BarChart3,
  BookOpenCheck,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Database,
  Gauge,
  LogOut,
  Moon,
  PackageCheck,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sun,
  Target,
  Warehouse
} from 'lucide-react';
import {
  clearCachedDashboardData,
  downloadTransactionsCsv,
  getActivityStatus,
  getBinMaster,
  getCachedCycleCoverage,
  getCachedConfig,
  getCachedDashboard,
  getConfig,
  getCycleCoverage,
  getDashboard,
  getSkuMaster,
  getTransactions,
  refreshDashboard
} from './api';
import { FilterBar } from './components/FilterBar';
import {
  CycleCoverageBanner,
  CycleCoveragePage
} from './components/CycleCoveragePage';
import { CalculationLogicPage } from './components/CalculationLogicPage';
import { InventoryTable } from './components/InventoryTable';
import { KpiCard } from './components/KpiCard';
import {
  MasterTable,
  type MasterColumn
} from './components/MasterTable';
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  hasDimensionFilters,
  getAccuracyStyle
} from './dashboardUtils';
import type {
  AbcBreakdown,
  AbcBreakdownRow,
  BinMasterRow,
  DashboardFilters,
  Kpis,
  PeriodData,
  PeriodKey,
  SkuMasterRow,
  TransactionQuery,
  TransactionCsvPeriod,
  TransactionSortKey
} from './types';

const PERIOD_KEYS: PeriodKey[] = [
  'lastQuarter',
  'lastMonth',
  'monthToDate',
  'yesterday'
];

type DashboardPage =
  | 'kpi'
  | 'transactions'
  | 'facilityProgress'
  | 'calculationLogic';

/** Builds a daily, month-to-date, or quarter-to-date range around one date. */
function csvPeriodRange(period: TransactionCsvPeriod, referenceDate: string) {
  const match = referenceDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || period === 'daily') {
    return { startDate: referenceDate, endDate: referenceDate };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const startMonth = period === 'mtd'
    ? month
    : Math.floor((month - 1) / 3) * 3 + 1;

  return {
    startDate: `${year}-${String(startMonth).padStart(2, '0')}-01`,
    endDate: referenceDate
  };
}

interface DashboardUser {
  name: string;
  email: string;
  picture: string;
  expiresAt: number;
}

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentityApi {
  initialize: (options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    hd?: string;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: Record<string, string | number | boolean>
  ) => void;
  disableAutoSelect: () => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleIdentityApi;
      };
    };
  }
}

const GOOGLE_CLIENT_ID = String(
  import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
).trim();
const GOOGLE_ALLOWED_DOMAIN = String(
  import.meta.env.VITE_GOOGLE_ALLOWED_DOMAIN || ''
)
  .trim()
  .toLowerCase();
const GOOGLE_SESSION_KEY = 'inventory-google-session-v1';

function decodeGoogleCredential(credential: string): DashboardUser {
  const sections = credential.split('.');
  if (sections.length !== 3) {
    throw new Error('Google returned an invalid sign-in response.');
  }

  const encodedPayload = sections[1]
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const paddedPayload = encodedPayload.padEnd(
    Math.ceil(encodedPayload.length / 4) * 4,
    '='
  );
  const payloadBytes = Uint8Array.from(
    window.atob(paddedPayload),
    (character) => character.charCodeAt(0)
  );
  const claims = JSON.parse(
    new TextDecoder().decode(payloadBytes)
  ) as {
    aud?: string;
    email?: string;
    email_verified?: boolean;
    exp?: number;
    hd?: string;
    name?: string;
    picture?: string;
  };
  const email = String(claims.email || '').trim().toLowerCase();
  const emailDomain = email.split('@')[1] || '';

  if (claims.aud !== GOOGLE_CLIENT_ID || !claims.email_verified || !email) {
    throw new Error('Google could not verify this account. Please try again.');
  }

  if (
    GOOGLE_ALLOWED_DOMAIN &&
    String(claims.hd || emailDomain).toLowerCase() !== GOOGLE_ALLOWED_DOMAIN
  ) {
    throw new Error(
      `Please sign in with your ${GOOGLE_ALLOWED_DOMAIN} Google account.`
    );
  }

  const expiresAt = Number(claims.exp || 0) * 1000;
  if (!expiresAt || expiresAt <= Date.now()) {
    throw new Error('The Google sign-in response has expired. Please try again.');
  }

  return {
    name: String(claims.name || email.split('@')[0]),
    email,
    picture: String(claims.picture || ''),
    expiresAt
  };
}

function getStoredGoogleUser() {
  try {
    const stored = window.sessionStorage.getItem(GOOGLE_SESSION_KEY);
    if (!stored) {
      return null;
    }

    const user = JSON.parse(stored) as DashboardUser;
    if (!user.email || user.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(GOOGLE_SESSION_KEY);
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

function storeGoogleUser(user: DashboardUser) {
  try {
    window.sessionStorage.setItem(GOOGLE_SESSION_KEY, JSON.stringify(user));
  } catch {
    // Private-browser storage restrictions must not block the current session.
  }
}

function clearGoogleUser() {
  try {
    window.sessionStorage.removeItem(GOOGLE_SESSION_KEY);
  } catch {
    // The in-memory session is still cleared by React state.
  }
}

function userInitials(user: DashboardUser) {
  return user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('') || 'GU';
}

function loadGoogleIdentity() {
  if (window.google?.accounts.id) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(
      'google-identity-services'
    ) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener(
        'error',
        () => reject(new Error('Google sign-in could not be loaded.')),
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-identity-services';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
    document.head.appendChild(script);
  });
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}

// Change this to true when the read-only Masters section is needed again.
const SHOW_MASTERS = false;

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
  { key: 'packSize', label: 'Pack Size', numeric: true },
  { key: 'abcClass', label: 'ABC Class' }
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
  const formatted = numberFormatter.format(Math.abs(value));
  return value < 0 ? `(${formatted})` : formatted;
}

function formatCurrency(value: number) {
  const formatted = currencyFormatter.format(Math.abs(value));
  return value < 0 ? `(${formatted})` : formatted;
}

function formatPercent(value: number) {
  const formatted = `${numberFormatter.format(Math.abs(value))}%`;
  return value < 0 ? `(${formatted})` : formatted;
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

function SignInScreen({
  onSignIn
}: {
  onSignIn: (user: DashboardUser) => void;
}) {
  const buttonContainer = useRef<HTMLDivElement>(null);
  const [isPreparing, setIsPreparing] = useState(true);
  const [signInError, setSignInError] = useState('');

  useEffect(() => {
    let isActive = true;

    async function prepareGoogleSignIn() {
      if (!GOOGLE_CLIENT_ID) {
        setSignInError('Google sign-in has not been configured.');
        setIsPreparing(false);
        return;
      }

      try {
        await loadGoogleIdentity();
        if (!isActive || !window.google?.accounts.id || !buttonContainer.current) {
          return;
        }

        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            try {
              const user = decodeGoogleCredential(response.credential);
              storeGoogleUser(user);
              setSignInError('');
              onSignIn(user);
            } catch (error) {
              setSignInError(
                error instanceof Error
                  ? error.message
                  : 'Google sign-in could not be completed.'
              );
            }
          },
          auto_select: false,
          cancel_on_tap_outside: false,
          ...(GOOGLE_ALLOWED_DOMAIN ? { hd: GOOGLE_ALLOWED_DOMAIN } : {})
        });

        buttonContainer.current.replaceChildren();
        window.google.accounts.id.renderButton(buttonContainer.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: Math.max(
            200,
            Math.min(300, buttonContainer.current.clientWidth)
          )
        });
      } catch (error) {
        if (isActive) {
          setSignInError(
            error instanceof Error
              ? error.message
              : 'Google sign-in could not be loaded.'
          );
        }
      } finally {
        if (isActive) {
          setIsPreparing(false);
        }
      }
    }

    prepareGoogleSignIn();
    return () => {
      isActive = false;
    };
  }, [onSignIn]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10 text-slate-950 dark:bg-slate-950 dark:text-white">
      <section className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-blue-950/10 dark:border-slate-800 dark:bg-slate-900">
        <div className="bg-gradient-to-br from-blue-950 via-blue-900 to-blue-700 px-7 py-8 text-white">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
            <ShieldCheck aria-hidden="true" className="h-6 w-6" />
          </span>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">
            Inventory visibility
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
            Inventory Health Dashboard
          </h1>
          <p className="mt-2 text-sm leading-6 text-blue-100">
            Sign in with your company Google account to open the dashboard.
          </p>
        </div>

        <div className="px-7 py-7">
          <h2 className="text-lg font-bold">Continue securely</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Use your {GOOGLE_ALLOWED_DOMAIN || 'authorized'} Google account.
          </p>

          <div className="mt-6 flex min-h-11 justify-center" ref={buttonContainer} />

          {isPreparing ? (
            <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
              Preparing Google sign-in...
            </p>
          ) : null}

          {signInError ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
            >
              {signInError}
            </p>
          ) : null}

          <p className="mt-6 text-center text-xs leading-5 text-slate-400">
            Signing out closes only this dashboard session. Your Gmail and other
            Google services remain signed in.
          </p>
        </div>
      </section>
    </main>
  );
}

function DashboardHeader({
  title,
  lastRefreshTime,
  isRefreshing,
  darkMode,
  user,
  onRefresh,
  onToggleTheme,
  onLogout
}: {
  title: string;
  lastRefreshTime?: string;
  isRefreshing: boolean;
  darkMode: boolean;
  user: DashboardUser;
  onRefresh: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="border-b border-blue-800 bg-gradient-to-r from-blue-950 via-blue-900 to-blue-800 text-white">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Warehouse aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">
              Inventory visibility
            </p>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">
              {title}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 items-center gap-2.5 rounded-xl bg-white/10 px-2.5 py-2 ring-1 ring-white/15">
            {user.picture ? (
              <img
                src={user.picture}
                alt=""
                referrerPolicy="no-referrer"
                className="h-9 w-9 shrink-0 rounded-full bg-white object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-blue-900">
                {userInitials(user)}
              </span>
            )}
            <span className="min-w-0 max-w-44">
              <span className="block truncate text-sm font-bold text-white">
                {user.name}
              </span>
              <span className="block truncate text-[11px] text-blue-200">
                {user.email}
              </span>
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="ml-1 flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-blue-100 transition hover:bg-white/15 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/60"
            >
              <LogOut aria-hidden="true" className="h-4 w-4" />
              Logout
            </button>
          </div>

          <div className="rounded-lg bg-white/10 px-3 py-1.5 ring-1 ring-white/15">
            <p className="text-xs text-blue-200">Last refresh</p>
            <p className="mt-0.5 text-sm font-semibold">
              {formatRefreshTime(lastRefreshTime)}
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex h-9 items-center gap-2 rounded-lg bg-white px-3 text-sm font-semibold text-blue-900 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:cursor-wait disabled:opacity-70"
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
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20 transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/60"
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
    <main
      role="status"
      aria-live="polite"
      aria-label="Loading inventory dashboard"
      className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-950 dark:bg-slate-950 dark:text-white"
    >
      <div className="w-full max-w-xs text-center">
        <span className="mx-auto flex h-[70px] w-[70px] items-center justify-center rounded-[20px] bg-gradient-to-br from-blue-950 to-blue-700 text-xl font-black tracking-tight text-white shadow-[0_18px_40px_-18px_rgba(30,64,175,0.8)]">
          IV
        </span>

        <div className="mx-auto mt-7 h-1.5 w-56 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <span className="dashboard-loading-progress block h-full rounded-full bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500" />
        </div>

        <h1 className="mt-6 text-xl font-extrabold tracking-tight">
          Loading Inventory Dashboard
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Preparing KPI, facility and cycle-count metrics...
        </p>
      </div>
    </main>
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

function SectionNavigation({
  activePage,
  onChange
}: {
  activePage: DashboardPage;
  onChange: (page: DashboardPage) => void;
}) {
  const links = [
    {
      page: 'kpi' as const,
      label: 'Executive KPI',
      description: 'Accuracy and KPI cards',
      icon: Gauge
    },
    {
      page: 'transactions' as const,
      label: 'Inventory Transactions',
      description: 'Search and CSV download',
      icon: Database
    },
    {
      page: 'facilityProgress' as const,
      label: 'Facility MTD Progress',
      description: 'Inventory and count coverage',
      icon: BarChart3
    },
    {
      page: 'calculationLogic' as const,
      label: 'Calculation Logic',
      description: 'Formulas and publication flow',
      icon: BookOpenCheck
    }
  ];

  return (
    <aside
      className="shrink-0 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:min-h-[calc(100vh-89px)] lg:w-56 lg:border-b-0 lg:border-r"
    >
      <nav
        aria-label="Dashboard pages"
        className="flex gap-2 overflow-x-auto px-4 py-3 lg:sticky lg:top-0 lg:flex-col lg:px-3 lg:py-4"
      >
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = activePage === link.page;
          return (
            <button
              type="button"
              key={link.page}
              onClick={() => onChange(link.page)}
              aria-current={isActive ? 'page' : undefined}
              className={`group flex min-w-52 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-500/30 lg:min-w-0 ${
                isActive
                  ? 'border-blue-700 bg-blue-700 text-white shadow-sm'
                  : 'border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-blue-700 dark:hover:bg-blue-950/40'
              }`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                }`}
              >
                <Icon aria-hidden="true" className="h-4.5 w-4.5" />
              </span>
              <span className="min-w-0">
                <span
                  className={`block text-sm font-bold ${
                    isActive ? 'text-white' : 'text-slate-900 dark:text-white'
                  }`}
                >
                  {link.label}
                </span>
                <span
                  className={`mt-0.5 block text-xs ${
                    isActive
                      ? 'text-blue-100'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {link.description}
                </span>
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function QuantityAccuracyBanner({
  periods,
  selectedPeriod,
  onSelectPeriod
}: {
  periods: Record<PeriodKey, PeriodData>;
  selectedPeriod: PeriodKey | null;
  onSelectPeriod: (periodKey: PeriodKey) => void;
}) {
  return (
      <section
        id="kpi-section"
        className="scroll-mt-80 overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-950 via-blue-900 to-blue-800 p-4 shadow-md shadow-blue-950/10 sm:p-5 xl:scroll-mt-32"
      >
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">
            Executive KPI
          </p>
          <h2 className="mt-1 text-xl font-bold text-white">
            Inventory Accuracy — Quantity
          </h2>
          <p className="mt-1 text-xs text-blue-200">
            Select a period to view its A, B, C quantity and COGS details.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {PERIOD_KEYS.map((periodKey) => {
            const period = periods[periodKey];
            const style = period.kpis.inventoryAccuracyStyle;
            const isSelected = selectedPeriod === periodKey;

            return (
              <button
                type="button"
                key={periodKey}
                aria-expanded={isSelected}
                aria-controls="abc-breakdown-panel"
                onClick={() => onSelectPeriod(periodKey)}
                className={`rounded-xl border bg-white p-3 text-left shadow-sm transition focus:outline-none focus:ring-4 focus:ring-blue-300/50 ${
                  isSelected
                    ? 'border-blue-300 ring-4 ring-blue-300/30'
                    : 'border-white/15 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md'
                }`}
              >
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {period.label}
                </p>
                <p
                  className="mt-1.5 text-2xl font-black tracking-tight"
                  style={{ color: style.text }}
                >
                  {formatPercent(period.kpis.inventoryAccuracy)}
                </p>
                <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-xs">
                  <p className="flex items-center justify-between gap-2 text-slate-600">
                    <span className="font-medium">System Qty</span>
                    <strong className="text-right text-slate-900">
                      {formatNumber(period.kpis.systemQuantity)}
                    </strong>
                  </p>
                  <p className="flex items-center justify-between gap-2 text-slate-600">
                    <span className="font-medium">Physical Qty</span>
                    <strong className="text-right text-slate-900">
                      {formatNumber(period.kpis.physicalQuantity)}
                    </strong>
                  </p>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {period.startDate} to {period.endDate}
                </p>
                <span
                  className="mt-2.5 block h-1 rounded-full"
                  style={{ backgroundColor: style.indicator }}
                />
                <span className="mt-2.5 flex items-center justify-between text-xs font-bold text-blue-700">
                  {isSelected ? 'Hide ABC details' : 'View ABC details'}
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-4 w-4 transition-transform ${
                      isSelected ? 'rotate-180' : ''
                    }`}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </section>
  );
}

function AbcBreakdownPanel({
  period,
  breakdown
}: {
  period: PeriodData;
  breakdown: AbcBreakdown | undefined;
}) {
  if (!breakdown) {
    return (
      <section
        id="abc-breakdown-panel"
        className="mt-4 scroll-mt-24 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 shadow-sm"
      >
        ABC details are not available in the current cached response. Refresh
        the dashboard after the Apps Script deployment is updated.
      </section>
    );
  }

  const hasUnclassifiedSkus = breakdown.unclassifiedSkuCount > 0;
  const rows = [
    ...breakdown.classes.filter(
      (row) => row.abcClass !== 'Unclassified' || row.uniqueSkuCount > 0
    ),
    breakdown.total
  ];

  return (
    <section
      id="abc-breakdown-panel"
      className="mt-4 scroll-mt-24 rounded-3xl border border-blue-200 bg-white p-5 shadow-sm dark:border-blue-900 dark:bg-slate-900 sm:p-6"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300">
            ABC Class Detail
          </p>
          <h3 className="mt-1 text-xl font-bold text-slate-950 dark:text-white">
            {period.label}: quantity and COGS capture
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {period.startDate} to {period.endDate} · Unique SKUs are counted
            once within each class.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-800 dark:bg-blue-950 dark:text-blue-200">
            Mapped SKUs: {formatNumber(breakdown.mappedSkuCount)}
          </span>
          {hasUnclassifiedSkus ? (
            <span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Unclassified SKUs:{' '}
              {formatNumber(breakdown.unclassifiedSkuCount)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-5 2xl:grid-cols-2">
        <AbcQuantityTable rows={rows} />
        <AbcValueTable rows={rows} />
      </div>

      <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
        {hasUnclassifiedSkus
          ? 'Unclassified includes blank or invalid ABC Class entries and SKUs not found in SKU_MASTER. '
          : ''}
        COGS values exclude GST; rows without a valid cost remain visible in
        Cost Coverage but are excluded from value totals.
      </p>
    </section>
  );
}

function AbcClassLabel({ row }: { row: AbcBreakdownRow }) {
  const className =
    row.abcClass === 'A'
      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
      : row.abcClass === 'B'
        ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200'
        : row.abcClass === 'C'
          ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200'
          : row.abcClass === 'Total'
            ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
            : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200';

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${className}`}
    >
      {row.abcClass}
    </span>
  );
}

function AbcQuantityTable({ rows }: { rows: AbcBreakdownRow[] }) {
  return (
    <AbcTableShell
      title="Quantity view"
      description="How much system quantity was selected and physically captured."
    >
      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        <tr>
          <th className="px-3 py-3 text-left">Class</th>
          <th className="px-3 py-3 text-right">Unique SKUs</th>
          <th className="px-3 py-3 text-right">System Qty</th>
          <th className="px-3 py-3 text-right">Physical Qty</th>
          <th className="px-3 py-3 text-right">Difference</th>
          <th className="px-3 py-3 text-right">Accuracy</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((row) => (
          <tr
            key={row.abcClass}
            className={
              row.abcClass === 'Total'
                ? 'bg-slate-50 font-bold dark:bg-slate-950'
                : ''
            }
          >
            <td className="px-3 py-3">
              <AbcClassLabel row={row} />
            </td>
            <td className="px-3 py-3 text-right">
              {formatNumber(row.uniqueSkuCount)}
            </td>
            <td className="px-3 py-3 text-right">
              {formatNumber(row.systemQuantity)}
            </td>
            <td className="px-3 py-3 text-right">
              {formatNumber(row.physicalQuantity)}
            </td>
            <td className="px-3 py-3 text-right">
              {formatNumber(row.differenceQuantity)}
            </td>
            <td
              className="px-3 py-3 text-right font-black"
              style={{ color: row.quantityAccuracyStyle.text }}
            >
              {formatPercent(row.quantityAccuracy)}
            </td>
          </tr>
        ))}
      </tbody>
    </AbcTableShell>
  );
}

function AbcValueTable({ rows }: { rows: AbcBreakdownRow[] }) {
  return (
    <AbcTableShell
      title="COGS value view"
      description="The same class capture measured at unit cost excluding GST."
    >
      <thead className="bg-emerald-50 text-xs uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
        <tr>
          <th className="px-3 py-3 text-left">Class</th>
          <th className="px-3 py-3 text-right">Costed SKUs</th>
          <th className="px-3 py-3 text-right">System Value</th>
          <th className="px-3 py-3 text-right">Physical Value</th>
          <th className="px-3 py-3 text-right">Difference</th>
          <th className="px-3 py-3 text-right">Accuracy</th>
          <th className="px-3 py-3 text-right">Coverage</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((row) => (
          <tr
            key={row.abcClass}
            className={
              row.abcClass === 'Total'
                ? 'bg-slate-50 font-bold dark:bg-slate-950'
                : ''
            }
          >
            <td className="px-3 py-3">
              <AbcClassLabel row={row} />
            </td>
            <td className="px-3 py-3 text-right">
              {formatNumber(row.costedSkuCount)}
            </td>
            <td className="px-3 py-3 text-right">
              {formatCurrency(row.systemValue)}
            </td>
            <td className="px-3 py-3 text-right">
              {formatCurrency(row.physicalValue)}
            </td>
            <td className="px-3 py-3 text-right">
              {formatCurrency(row.differenceValue)}
            </td>
            <td
              className="px-3 py-3 text-right font-black"
              style={{ color: row.valueAccuracyStyle.text }}
            >
              {formatPercent(row.valueAccuracy)}
            </td>
            <td className="px-3 py-3 text-right">
              {formatPercent(row.costCoverage)}
            </td>
          </tr>
        ))}
      </tbody>
    </AbcTableShell>
  );
}

function AbcTableShell({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h4 className="font-bold text-slate-950 dark:text-white">
          {title}
        </h4>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {description}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full whitespace-nowrap text-sm">
          {children}
        </table>
      </div>
    </div>
  );
}

function ValueAccuracyBanner({
  periods,
  selectedPeriod,
  onSelectPeriod
}: {
  periods: Record<PeriodKey, PeriodData>;
  selectedPeriod: PeriodKey | null;
  onSelectPeriod: (periodKey: PeriodKey) => void;
}) {
  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/20 sm:p-5">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
          COGS KPI
        </p>
        <h2 className="mt-1 text-xl font-bold text-slate-950 dark:text-white">
          Inventory Accuracy — Value / COGS
        </h2>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Uses costed rows and COGS excluding GST. Coverage shows the share of
          rows with a valid cost.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {PERIOD_KEYS.map((periodKey) => {
          const period = periods[periodKey];
          const absoluteDifferenceValue =
            period.kpis.shortValue + period.kpis.excessValue;
          const valueAccuracy = Number.isFinite(period.kpis.valueAccuracy)
            ? period.kpis.valueAccuracy
            : period.kpis.systemValue === 0
              ? 0
              : 100 -
                (absoluteDifferenceValue / period.kpis.systemValue) * 100;
          const style =
            period.kpis.valueAccuracyStyle ||
            getAccuracyStyle(valueAccuracy);
          const isSelected = selectedPeriod === periodKey;
          return (
            <button
              type="button"
              key={periodKey}
              aria-expanded={isSelected}
              aria-controls="abc-breakdown-panel"
              onClick={() => onSelectPeriod(periodKey)}
              className={`rounded-xl border bg-white p-3 text-left shadow-sm transition focus:outline-none focus:ring-4 focus:ring-emerald-300/50 dark:border-emerald-900 ${
                isSelected
                  ? 'border-emerald-400 ring-4 ring-emerald-300/30'
                  : 'border-emerald-100 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md'
              }`}
            >
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {period.label}
              </p>
              <p
                className="mt-1.5 text-xl font-black tracking-tight"
                style={{ color: style.text }}
              >
                {formatPercent(valueAccuracy)}
              </p>
              <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-xs">
                <p className="flex items-center justify-between gap-2 text-slate-600">
                  <span className="font-medium">System Value</span>
                  <strong className="text-right text-slate-900">
                    {formatCurrency(period.kpis.systemValue)}
                  </strong>
                </p>
                <p className="flex items-center justify-between gap-2 text-slate-600">
                  <span className="font-medium">Physical Value</span>
                  <strong className="text-right text-slate-900">
                    {formatCurrency(period.kpis.physicalValue)}
                  </strong>
                </p>
                <p className="flex items-center justify-between gap-2 text-slate-600">
                  <span className="font-medium">Cost Coverage</span>
                  <strong className="text-right text-slate-900">
                    {formatPercent(period.kpis.costCoverage)}
                  </strong>
                </p>
              </div>
              <span
                className="mt-2.5 block h-1 rounded-full"
                style={{ backgroundColor: style.indicator }}
              />
              <span className="mt-2.5 flex items-center justify-between text-xs font-bold text-emerald-700">
                {isSelected ? 'Hide ABC details' : 'View ABC details'}
                <ChevronDown
                  aria-hidden="true"
                  className={`h-4 w-4 transition-transform ${
                    isSelected ? 'rotate-180' : ''
                  }`}
                />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function YesterdayActivityNotice({
  period
}: {
  period: PeriodData;
}) {
  if (period.rowCount > 0) {
    return null;
  }

  const reason =
    period.zeroActivity?.reason || 'Not entered in Activity_Status';
  const remark = period.zeroActivity?.remark || '';

  return (
    <section
      role="status"
      className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 shadow-sm dark:border-amber-800 dark:bg-amber-950/30"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
          <AlertCircle aria-hidden="true" className="h-5 w-5" />
        </span>
        <div>
          <h3 className="font-bold text-amber-950 dark:text-amber-100">
            No cycle count was performed yesterday.
          </h3>
          <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">
            <strong>Reason:</strong> {reason}
          </p>
          {remark ? (
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
              <strong>Remark:</strong> {remark}
            </p>
          ) : null}
          {!period.zeroActivity?.reason ? (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              Add the date, reason, and optional remark in the
              Activity_Status sheet, then refresh the dashboard.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function KpiGrid({ kpis }: { kpis: Kpis }) {
  const completionStyle = getAccuracyStyle(
    kpis.cycleCountCompletion
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Bin Accuracy"
          value={formatPercent(kpis.binAccuracy)}
          description="Accurate bins divided by counted unique Facility + Rack + Shelf bins."
          icon={CheckCircle2}
          tone={accuracyTone(kpis.binAccuracyStyle.name)}
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
          tone={accuracyTone(completionStyle.name)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Inventory Accuracy"
        value={formatPercent(kpis.inventoryAccuracy)}
        description="Accuracy based on total absolute quantity difference."
        icon={Gauge}
        tone={accuracyTone(kpis.inventoryAccuracyStyle.name)}
      />
      <KpiCard
        label="System Qty and Value"
        value={formatNumber(kpis.systemQuantity)}
        secondaryLabel="Value"
        secondaryValue={formatCurrency(kpis.systemValue)}
        description="Total quantity recorded by the inventory system."
        icon={Database}
        tone="blue"
      />
      <KpiCard
        label="Physical Qty and Value"
        value={formatNumber(kpis.physicalQuantity)}
        secondaryLabel="Value"
        secondaryValue={formatCurrency(kpis.physicalValue)}
        description="Total quantity physically counted."
        icon={Boxes}
        tone="purple"
      />
      <KpiCard
        label="Net Diff Qty and Value"
        value={formatNumber(kpis.netDifference)}
        secondaryLabel="Value"
        secondaryValue={formatCurrency(kpis.netDifferenceValue)}
        description="Physical quantity minus system quantity."
        icon={Scale}
        tone={kpis.netDifference < 0 ? 'red' : 'blue'}
      />
      </div>
    </div>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const [signedInUser, setSignedInUser] = useState<DashboardUser | null>(
    getStoredGoogleUser
  );
  const [activePage, setActivePage] = useState<DashboardPage>('kpi');
  const [coverageMonth, setCoverageMonth] = useState('');
  const [filters, setFilters] =
    useState<DashboardFilters>({ ...EMPTY_FILTERS });
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('inventory-theme') === 'dark';
  });
  const [themeInitialized, setThemeInitialized] = useState(() => {
    return localStorage.getItem('inventory-theme') !== null;
  });
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(25);
  const [tableSearch, setTableSearch] = useState('');
  const [tableSortKey, setTableSortKey] =
    useState<TransactionSortKey>('date');
  const [tableSortDirection, setTableSortDirection] =
    useState<'asc' | 'desc'>('desc');
  const [exportingCsvPeriod, setExportingCsvPeriod] =
    useState<TransactionCsvPeriod | null>(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [selectedAbcPeriod, setSelectedAbcPeriod] =
    useState<PeriodKey | null>(null);
  const debouncedTableSearch = useDebouncedValue(tableSearch, 400);

  const configQuery = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    initialData: getCachedConfig,
    enabled: Boolean(signedInUser),
    staleTime: 5 * 60 * 1000,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000)
  });

  const refreshInterval =
    (configQuery.data?.data.autoRefreshMinutes || 30) * 60 * 1000;

  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
    initialData: getCachedDashboard,
    enabled: Boolean(signedInUser),
    refetchInterval: refreshInterval,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000)
  });

  const dashboard = dashboardQuery.data?.data;
  const config = configQuery.data?.data;
  const period = dashboard?.periods.monthToDate;
  const transactionStartDate = filters.date || period?.startDate || '';
  const transactionEndDate = filters.date || period?.endDate || '';
  const transactionParameters: TransactionQuery = {
    startDate: transactionStartDate,
    endDate: transactionEndDate,
    facility: filters.facility,
    page: tablePage,
    pageSize: tablePageSize,
    search: debouncedTableSearch,
    sortKey: tableSortKey,
    sortDirection: tableSortDirection,
    includeUndatedNtf: !filters.date
  };

  const transactionsQuery = useQuery({
    queryKey: [
      'transactions',
      transactionStartDate,
      transactionEndDate,
      filters.facility,
      tablePage,
      tablePageSize,
      debouncedTableSearch,
      tableSortKey,
      tableSortDirection
    ],
    queryFn: () => getTransactions(transactionParameters),
    enabled:
      Boolean(signedInUser) &&
      activePage === 'transactions' &&
      Boolean(transactionStartDate && transactionEndDate),
    refetchInterval: refreshInterval,
    retry: 1,
    placeholderData: (previousData) => previousData
  });

  const binMasterQuery = useQuery({
    queryKey: ['binMaster'],
    queryFn: getBinMaster,
    enabled: Boolean(signedInUser) && SHOW_MASTERS,
    refetchInterval: refreshInterval,
    retry: 1
  });

  const skuMasterQuery = useQuery({
    queryKey: ['skuMaster'],
    queryFn: getSkuMaster,
    enabled: Boolean(signedInUser) && SHOW_MASTERS,
    refetchInterval: refreshInterval,
    retry: 1
  });

  const cycleCoverageQuery = useQuery({
    queryKey: ['cycleCoverage', coverageMonth],
    queryFn: () => getCycleCoverage(coverageMonth),
    initialData: coverageMonth ? undefined : getCachedCycleCoverage,
    enabled:
      Boolean(signedInUser) &&
      (activePage === 'kpi' || activePage === 'facilityProgress'),
    refetchInterval: refreshInterval,
    retry: 1
  });

  const transactionPage = transactionsQuery.data?.data;
  const transactions = transactionPage?.rows || [];
  const binMaster = binMasterQuery.data?.data || [];
  const skuMaster = skuMasterQuery.data?.data || [];
  const filtersAreActive =
    activePage === 'transactions' && hasActiveFilters(filters);
  const dimensionFiltersAreActive =
    activePage === 'transactions' && hasDimensionFilters(filters);
  const filterOptions = {
    facilities: transactionPage?.facilities || [],
    racks: [],
    skus: [],
    batches: [],
    remarks: []
  };
  const visibleKpis = activePage === 'kpi'
    ? dashboard?.periods.monthToDate.kpis || null
    : transactionPage?.kpis || null;
  const selectedRowCount = activePage === 'kpi'
    ? dashboard?.periods.monthToDate.rowCount || 0
    : transactionPage?.selectedRowCount || 0;
  const bannerPeriods = dashboard?.periods;
  const selectedAbcPeriodData =
    selectedAbcPeriod && bannerPeriods
      ? bannerPeriods[selectedAbcPeriod]
      : null;

  const activityQuery = useQuery({
    queryKey: ['activityStatus', filters.date],
    queryFn: () => getActivityStatus(filters.date),
    enabled:
      Boolean(signedInUser) &&
      activePage === 'transactions' &&
      Boolean(filters.date) &&
      !transactionsQuery.isLoading &&
      !transactionsQuery.error &&
      selectedRowCount === 0 &&
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

  useEffect(() => {
    if (!selectedAbcPeriod) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      document.getElementById('abc-breakdown-panel')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [selectedAbcPeriod]);

  useEffect(() => {
    if (!signedInUser) {
      return;
    }

    const remainingSessionTime = signedInUser.expiresAt - Date.now();
    if (remainingSessionTime <= 0) {
      clearGoogleUser();
      setSignedInUser(null);
      return;
    }

    const timer = window.setTimeout(() => {
      clearGoogleUser();
      clearCachedDashboardData();
      queryClient.clear();
      setSignedInUser(null);
    }, remainingSessionTime);

    return () => window.clearTimeout(timer);
  }, [queryClient, signedInUser]);

  const isLoading =
    (!dashboard && dashboardQuery.isLoading) ||
    (SHOW_MASTERS &&
      (binMasterQuery.isLoading || skuMasterQuery.isLoading));
  const error =
    (!dashboard && dashboardQuery.error) ||
    (SHOW_MASTERS && (binMasterQuery.error || skuMasterQuery.error));
  const backgroundDataError = dashboard
    ? dashboardQuery.error || configQuery.error
    : null;
  const isRefreshing =
    isManualRefreshing ||
    configQuery.isFetching ||
    dashboardQuery.isFetching ||
    (activePage === 'transactions' && transactionsQuery.isFetching) ||
    ((activePage === 'kpi' || activePage === 'facilityProgress') &&
      cycleCoverageQuery.isFetching) ||
    (SHOW_MASTERS &&
      (binMasterQuery.isFetching || skuMasterQuery.isFetching));

  async function retryAll() {
    setIsManualRefreshing(true);

    try {
      await refreshDashboard();
    } catch (error) {
      console.error('The cloud dashboard refresh failed.', error);
    }

    const requests: Promise<unknown>[] = [
      configQuery.refetch(),
      dashboardQuery.refetch()
    ];

    if (activePage === 'transactions') {
      requests.push(transactionsQuery.refetch());
    }

    if (activePage === 'kpi' || activePage === 'facilityProgress') {
      requests.push(cycleCoverageQuery.refetch());
    }

    if (SHOW_MASTERS) {
      requests.push(
        binMasterQuery.refetch(),
        skuMasterQuery.refetch()
      );
    }

    await Promise.allSettled(requests);
    setIsManualRefreshing(false);
  }

  function logout() {
    window.google?.accounts.id.disableAutoSelect();
    clearGoogleUser();
    clearCachedDashboardData();
    queryClient.clear();
    setActivePage('kpi');
    setSignedInUser(null);
  }

  function updateFilter(
    name: keyof DashboardFilters,
    value: string
  ) {
    setTablePage(1);
    setFilters((current) => ({
      ...current,
      [name]: value
    }));
  }

  function clearFilters() {
    setTablePage(1);
    setFilters({ ...EMPTY_FILTERS });
  }

  function updateTableSearch(value: string) {
    setTablePage(1);
    setTableSearch(value);
  }

  function updateTableSort(
    key: TransactionSortKey,
    direction: 'asc' | 'desc'
  ) {
    setTablePage(1);
    setTableSortKey(key);
    setTableSortDirection(direction);
  }

  function updateTablePageSize(pageSize: number) {
    setTablePage(1);
    setTablePageSize(pageSize);
  }

  async function exportTransactionsCsv(period: TransactionCsvPeriod) {
    const referenceDate = filters.date || transactionEndDate;
    const range = csvPeriodRange(period, referenceDate);
    setExportingCsvPeriod(period);

    try {
      const result = await downloadTransactionsCsv({
        ...transactionParameters,
        startDate: range.startDate,
        endDate: range.endDate,
        page: 1,
        search: tableSearch,
        includeUndatedNtf: period !== 'daily'
      });
      const downloadUrl = URL.createObjectURL(result.blob);
      const link = document.createElement('a');

      link.href = downloadUrl;
      link.download = `inventory-transactions-${period}-${range.startDate}-to-${range.endDate}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (downloadError) {
      window.alert(
        downloadError instanceof Error
          ? downloadError.message
          : 'Unable to prepare the CSV file.'
      );
    } finally {
      setExportingCsvPeriod(null);
    }
  }

  const title =
    config?.dashboardName ||
    dashboard?.dashboardName ||
    'Inventory Health Dashboard';
  const lastRefreshTime =
    dashboardQuery.data?.lastRefreshTime ||
    transactionsQuery.data?.lastRefreshTime;
  const transactionInitialLoading =
    activePage === 'transactions' &&
    transactionsQuery.isLoading &&
    !transactionPage;
  const transactionErrorMessage = activePage === 'transactions'
    ? transactionsQuery.error instanceof Error
      ? transactionsQuery.error.message
      : transactionsQuery.error
        ? 'The selected transaction data could not be loaded.'
        : ''
    : '';
  const cycleCoverageErrorMessage =
    cycleCoverageQuery.error instanceof Error
      ? cycleCoverageQuery.error.message
      : cycleCoverageQuery.error
        ? 'The facility progress request failed.'
        : '';

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

  if (!signedInUser) {
    return <SignInScreen onSignIn={setSignedInUser} />;
  }

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <DashboardHeader
        title={title}
        lastRefreshTime={lastRefreshTime}
        isRefreshing={isRefreshing}
        darkMode={darkMode}
        user={signedInUser}
        onRefresh={retryAll}
        onToggleTheme={() => {
          setThemeInitialized(true);
          setDarkMode((current) => !current);
        }}
        onLogout={logout}
      />

      {error ? (
        <ErrorState
          message={
            error instanceof Error
              ? error.message
              : 'An unexpected error occurred.'
          }
          onRetry={retryAll}
        />
      ) : !dashboard ? (
        <ErrorState
          message="The API response did not include dashboard data."
          onRetry={retryAll}
        />
      ) : dashboard.sourceSummary.totalTransactionRowCount === 0 ? (
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
        <div className="lg:flex">
          <SectionNavigation
            activePage={activePage}
            onChange={(page) => {
              setActivePage(page);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />

          <div className="min-w-0 flex-1">
            {activePage === 'transactions' ? (
              <FilterBar
                filters={filters}
                options={filterOptions}
                onChange={updateFilter}
                onClear={clearFilters}
              />
            ) : null}

          {backgroundDataError ? (
            <section
              role="status"
              className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <div className="mx-auto flex max-w-[1600px] flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-2">
                <p>
                  <strong>Latest cloud refresh is temporarily unavailable.</strong>{' '}
                  Showing the last successful KPI snapshot from{' '}
                  {formatRefreshTime(lastRefreshTime)}.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void Promise.all([
                      dashboardQuery.refetch(),
                      configQuery.refetch()
                    ]);
                  }}
                  className="w-fit rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 transition hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900"
                >
                  Retry latest data
                </button>
              </div>
            </section>
          ) : null}

          <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-5 lg:px-6">
            {activePage === 'kpi' ? (
              <>
            <CycleCoverageBanner
              latest={cycleCoverageQuery.data?.data.latest}
              isLoading={cycleCoverageQuery.isLoading}
              errorMessage={cycleCoverageErrorMessage}
              changeAlertThreshold={
                config?.inventoryChangeAlertPercent || 5
              }
              onRetry={() => {
                void cycleCoverageQuery.refetch();
              }}
              className="mb-4"
            />
            <QuantityAccuracyBanner
              periods={bannerPeriods || dashboard.periods}
              selectedPeriod={selectedAbcPeriod}
              onSelectPeriod={(periodKey) => {
                setSelectedAbcPeriod((current) =>
                  current === periodKey ? null : periodKey
                );
              }}
            />
            <ValueAccuracyBanner
              periods={bannerPeriods || dashboard.periods}
              selectedPeriod={selectedAbcPeriod}
              onSelectPeriod={(periodKey) => {
                setSelectedAbcPeriod((current) =>
                  current === periodKey ? null : periodKey
                );
              }}
            />
            {selectedAbcPeriodData ? (
              <AbcBreakdownPanel
                period={selectedAbcPeriodData}
                breakdown={selectedAbcPeriodData.abcBreakdown}
              />
            ) : null}
            <YesterdayActivityNotice
              period={dashboard.periods.yesterday}
            />
            <div className="mb-4 mt-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                  Section 1 ·{' '}
                  {period?.label}
                </p>
                <h2 className="mt-1 text-xl font-bold tracking-tight">
                  Executive KPI
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {transactionInitialLoading
                    ? 'Loading the selected transaction summary...'
                    : filtersAreActive
                    ? `${formatNumber(selectedRowCount)} matching rows`
                    : `${formatNumber(selectedRowCount)} Month-to-Date rows`}
                </p>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <Database className="h-3.5 w-3.5 text-blue-600" />
                {formatNumber(
                  dashboard.sourceSummary.totalTransactionRowCount
                )} current + historical rows
              </span>
            </div>

            {transactionInitialLoading ? (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 px-6 py-10 text-center shadow-sm dark:border-blue-900 dark:bg-blue-950/30">
                <RefreshCw className="mx-auto h-10 w-10 animate-spin text-blue-600 dark:text-blue-400" />
                <h3 className="mt-4 text-lg font-semibold text-blue-950 dark:text-blue-100">
                  Loading selected-period details
                </h3>
                <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-blue-800 dark:text-blue-300">
                  The KPI banners are ready. Transaction details are being
                  calculated in the background.
                </p>
              </div>
            ) : transactionErrorMessage ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-10 text-center shadow-sm dark:border-red-900 dark:bg-red-950/30">
                <AlertCircle className="mx-auto h-10 w-10 text-red-600 dark:text-red-400" />
                <h3 className="mt-4 text-lg font-semibold text-red-950 dark:text-red-100">
                  Transaction details could not be loaded
                </h3>
                <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-red-800 dark:text-red-300">
                  {transactionErrorMessage}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void transactionsQuery.refetch();
                  }}
                  className="mt-5 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800"
                >
                  Retry transaction data
                </button>
              </div>
            ) : selectedRowCount === 0 ? (
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
              <KpiGrid kpis={visibleKpis} />
            ) : null}
              </>
            ) : null}

            {activePage === 'transactions' ? (
            <section
              id="transactions-section"
              className="scroll-mt-80 xl:scroll-mt-32"
            >
              <div className="mb-5">
                <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                  Section 2
                </p>
                <h2 className="mt-1 text-xl font-bold tracking-tight">
                  Inventory Transactions
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Search, sort, paginate, and download the filtered rows as CSV.
                </p>
              </div>
              {visibleKpis && selectedRowCount > 0 ? (
                <div className="mb-8">
                  <KpiGrid kpis={visibleKpis} />
                </div>
              ) : null}
              {transactionErrorMessage ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-center text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  Transaction table unavailable. Use the retry button in
                  Section 1.
                </div>
              ) : (
                <InventoryTable
                  rows={transactions}
                  totalRows={transactionPage?.totalRows || 0}
                  page={transactionPage?.page || tablePage}
                  pageSize={transactionPage?.pageSize || tablePageSize}
                  pageCount={transactionPage?.pageCount || 1}
                  searchText={tableSearch}
                  sortKey={tableSortKey}
                  sortDirection={tableSortDirection}
                  isLoading={transactionsQuery.isFetching}
                  exportingPeriod={exportingCsvPeriod}
                  onSearchChange={updateTableSearch}
                  onSortChange={updateTableSort}
                  onPageChange={setTablePage}
                  onPageSizeChange={updateTablePageSize}
                  onExportCsv={(period) => {
                    void exportTransactionsCsv(period);
                  }}
                />
              )}
            </section>
            ) : null}

            {activePage === 'facilityProgress' ? (
              <CycleCoveragePage
                data={cycleCoverageQuery.data?.data}
                isLoading={cycleCoverageQuery.isLoading}
                errorMessage={
                  cycleCoverageErrorMessage
                }
                selectedMonth={coverageMonth}
                onMonthChange={setCoverageMonth}
                changeAlertThreshold={
                  config?.inventoryChangeAlertPercent || 5
                }
                onRetry={() => {
                  void cycleCoverageQuery.refetch();
                }}
              />
            ) : null}

            {activePage === 'calculationLogic' ? (
              <CalculationLogicPage config={config} />
            ) : null}

            {SHOW_MASTERS ? (
              <section
                id="masters-section"
                className="mt-10 scroll-mt-80 xl:scroll-mt-32"
              >
              <div className="mb-5">
                <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                  Section 3
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">
                  Masters
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
            ) : null}
          </main>
          </div>
        </div>
      )}
    </div>
  );
}
