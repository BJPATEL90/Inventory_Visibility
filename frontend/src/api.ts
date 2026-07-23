import type {
  ActivityStatus,
  ApiResponse,
  BinMasterRow,
  DashboardConfig,
  DashboardData,
  InventoryTransaction,
  SkuMasterRow
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

export function getTransactions() {
  return request<InventoryTransaction[]>('transactions');
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
