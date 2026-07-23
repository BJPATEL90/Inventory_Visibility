export type PeriodKey =
  | 'lastQuarter'
  | 'lastMonth'
  | 'monthToDate'
  | 'yesterday';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  lastRefreshTime?: string;
  message?: string;
}

export interface AccuracyStyle {
  name: 'Red' | 'Yellow' | 'Green';
  text: string;
  background: string;
  indicator: string;
}

export interface Kpis {
  inventoryAccuracy: number;
  inventoryAccuracyStyle: AccuracyStyle;
  binAccuracy: number;
  binAccuracyStyle: AccuracyStyle;
  systemQuantity: number;
  physicalQuantity: number;
  netDifference: number;
  shortQuantity: number;
  excessQuantity: number;
  systemValue: number;
  physicalValue: number;
  totalInventoryValue: number;
  netDifferenceValue: number;
  shortValue: number;
  excessValue: number;
  costCoverage: number;
  costedRowCount: number;
  missingCostRowCount: number;
  missingCostSkuCount: number;
  plannedBinCount: number;
  actualBinCount: number;
  cycleCountCompletion: number;
  ntfCount: number;
  ntfQuantity: number;
  ntfValue: number;
}

export interface ZeroActivity {
  message: string;
  reason: string;
  remark: string;
}

export interface PeriodData {
  label: string;
  startDate: string;
  endDate: string;
  rowCount: number;
  kpis: Kpis;
  zeroActivity: ZeroActivity | null;
}

export interface DashboardData {
  dashboardName: string;
  theme: string;
  periods: Record<PeriodKey, PeriodData>;
  sourceSummary: {
    combinedRowCount: number;
    historicalRowCount: number;
    totalTransactionRowCount: number;
    rowsByFacility: Record<string, number>;
    skippedSourceSheets: string[];
    costSummary: {
      costSheetName: string;
      currency: 'INR';
      includesGst: boolean;
      costedRowCount: number;
      missingCostRowCount: number;
      missingCostSkuCount: number;
      costCoverage: number;
    };
  };
}

export interface DashboardConfig {
  dashboardName: string;
  dailyPlannedBinCount: number;
  workingDays: number;
  autoRefreshMinutes: number;
  emailEnabled: boolean;
  emailTo: string;
  emailCC: string;
  emailBCC: string;
  emailSubject: string;
  emailSendHour: number;
  dashboardUrl: string;
  theme: string;
}

export interface InventoryTransaction {
  id: string;
  sourceType: 'current' | 'historical';
  facility: string;
  date: string;
  rack: string;
  skuCode: string;
  itemName: string;
  shelf: string;
  batch: string;
  vendorBatchNumber: string;
  pack: number;
  box: number;
  loose: number;
  physicalQuantity: number;
  systemQuantity: number;
  difference: number;
  costAvailable: boolean;
  unitCost: number | null;
  gstRate: number | null;
  systemValue: number | null;
  physicalValue: number | null;
  differenceValue: number | null;
  remark: string;
}

export interface ActivityStatus {
  date: string;
  reason: string;
  remark: string;
}

export interface BinMasterRow {
  facility: string;
  rack: string;
  bin: string;
  status: string;
}

export interface SkuMasterRow {
  sku: string;
  itemName: string;
  brand: string;
  category: string;
  packSize: string;
}

export interface DashboardFilters {
  date: string;
  facility: string;
  rack: string;
  sku: string;
  batch: string;
  remark: string;
}

export interface FilterOptions {
  facilities: string[];
  racks: string[];
  skus: string[];
  batches: string[];
  remarks: string[];
}

export interface ChartDataset {
  categories: string[];
  values: number[];
  pointColors?: string[];
}

export interface DashboardChartData {
  inventoryAccuracyTrend: ChartDataset;
  binAccuracyTrend: ChartDataset;
  facilityInventoryAccuracy: ChartDataset;
  ntfTrend: ChartDataset;
}
