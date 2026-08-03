import type {
  ActivityStatus,
  ApiResponse,
  BinMasterRow,
  DashboardConfig,
  DashboardData,
  SkuMasterRow,
  TransactionPageData,
  TransactionQuery
} from './types';

const APPS_SCRIPT_URL = String(
  import.meta.env.VITE_APPS_SCRIPT_URL || ''
).trim();

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
    redirect: 'follow'
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

export function getDashboard() {
  return request<DashboardData>('dashboard');
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

export function getConfig() {
  return request<DashboardConfig>('config');
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
