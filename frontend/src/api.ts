import type {
  ActivityStatus,
  ApiResponse,
  BinMasterRow,
  CycleCoverageData,
  DashboardConfig,
  DashboardData,
  DashboardRefreshResult,
  SkuMasterRow,
  TransactionPageData,
  TransactionQuery
} from './types';

const APPS_SCRIPT_URL = String(
  import.meta.env.VITE_APPS_SCRIPT_URL || ''
).trim();
const DASHBOARD_SNAPSHOT_KEY = 'inventory-dashboard-snapshot-v1';
const CONFIG_SNAPSHOT_KEY = 'inventory-config-snapshot-v1';
const CYCLE_COVERAGE_SNAPSHOT_KEY = 'inventory-cycle-coverage-v2';

interface StoredSnapshot<T> {
  savedAt: string;
  response: ApiResponse<T>;
}

function readSnapshot<T>(key: string) {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const storedText = window.localStorage.getItem(key);
    if (!storedText) {
      return undefined;
    }

    const stored = JSON.parse(storedText) as StoredSnapshot<T>;
    return stored.response?.success && stored.response.data
      ? stored.response
      : undefined;
  } catch {
    return undefined;
  }
}

function saveSnapshot<T>(key: string, response: ApiResponse<T>) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const stored: StoredSnapshot<T> = {
      savedAt: new Date().toISOString(),
      response
    };
    window.localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // A storage restriction must never prevent the live dashboard from loading.
  }
}

function getApiUrl(
  action: string,
  parameters: Record<string, string> = {}
) {
  if (!APPS_SCRIPT_URL) {
    throw new Error(
      'VITE_APPS_SCRIPT_URL is missing. Create frontend/.env.local and add your Apps Script Web App URL.'
    );
  }

  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', action);

  Object.entries(parameters).forEach(([name, value]) => {
    if (value) {
      url.searchParams.set(name, value);
    }
  });

  return url.toString();
}

async function request<T>(
  action: string,
  parameters: Record<string, string> = {}
): Promise<ApiResponse<T>> {
  const response = await fetch(getApiUrl(action, parameters), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    redirect: 'follow',
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(
      `The Apps Script request failed with status ${response.status}.`
    );
  }

  const responseText = await response.text();
  let payload: ApiResponse<T>;

  try {
    payload = JSON.parse(responseText) as ApiResponse<T>;
  } catch {
    throw new Error(
      'The Apps Script URL did not return JSON. Check the Web App URL and deployment access.'
    );
  }

  if (!payload.success) {
    throw new Error(payload.message || 'The Apps Script request failed.');
  }

  return payload;
}

export function getCachedDashboard() {
  return readSnapshot<DashboardData>(DASHBOARD_SNAPSHOT_KEY);
}

export async function getDashboard() {
  const response = await request<DashboardData>('dashboard');
  saveSnapshot(DASHBOARD_SNAPSHOT_KEY, response);
  return response;
}

export function refreshDashboard() {
  return request<DashboardRefreshResult>('refreshDashboard');
}

function transactionParameters(query: TransactionQuery) {
  return {
    startDate: query.startDate,
    endDate: query.endDate,
    facility: query.facility,
    page: String(query.page),
    pageSize: String(query.pageSize),
    search: query.search,
    sortKey: query.sortKey,
    sortDirection: query.sortDirection,
    includeUndatedNtf: String(query.includeUndatedNtf)
  };
}

export function getTransactions(query: TransactionQuery) {
  return request<TransactionPageData>(
    'transactions',
    transactionParameters(query)
  );
}

export function getFacilityDashboard(facility: string) {
  return request<DashboardData>('facilityDashboard', { facility });
}

export async function downloadTransactionsCsv(query: TransactionQuery) {
  const response = await fetch(
    getApiUrl('transactionsCsv', transactionParameters(query)),
    {
      method: 'GET',
      headers: {
        Accept: 'text/csv'
      },
      redirect: 'follow'
    }
  );

  if (!response.ok) {
    throw new Error(
      `The CSV request failed with status ${response.status}.`
    );
  }

  const responseText = await response.text();
  if (/^\s*</.test(responseText)) {
    throw new Error(
      'Google did not return the CSV file. Try a smaller date range.'
    );
  }

  if (/^\s*\{/.test(responseText)) {
    try {
      const errorPayload = JSON.parse(responseText) as ApiResponse<unknown>;
      if (!errorPayload.success) {
        throw new Error(
          errorPayload.message || 'Unable to prepare the CSV file.'
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
    }
  }

  return {
    blob: new Blob([responseText], {
      type: 'text/csv;charset=utf-8'
    }),
    fileName: `inventory-transactions-${query.startDate}-to-${query.endDate}.csv`
  };
}

export function getCachedConfig() {
  return readSnapshot<DashboardConfig>(CONFIG_SNAPSHOT_KEY);
}

export async function getConfig() {
  const response = await request<DashboardConfig>('config');
  saveSnapshot(CONFIG_SNAPSHOT_KEY, response);
  return response;
}

export function getCachedCycleCoverage() {
  return readSnapshot<CycleCoverageData>(CYCLE_COVERAGE_SNAPSHOT_KEY);
}

export async function getCycleCoverage(month = '') {
  const response = await request<CycleCoverageData>('cycleCoverage', {
    month
  });
  saveSnapshot(CYCLE_COVERAGE_SNAPSHOT_KEY, response);
  return response;
}

export function getBinMaster() {
  return request<BinMasterRow[]>('binMaster');
}

export function getSkuMaster() {
  return request<SkuMasterRow[]>('skuMaster');
}

export function getActivityStatus(date: string) {
  return request<ActivityStatus[]>('activityStatus', { date });
}
