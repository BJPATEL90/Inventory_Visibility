import type {
  AccuracyStyle,
  DashboardFilters,
  FilterOptions,
  InventoryTransaction,
  Kpis
} from './types';

export const EMPTY_FILTERS: DashboardFilters = {
  date: '',
  facility: '',
  rack: '',
  sku: '',
  batch: '',
  remark: ''
};

export function hasActiveFilters(filters: DashboardFilters) {
  return Object.values(filters).some(Boolean);
}

export function hasDimensionFilters(filters: DashboardFilters) {
  return Boolean(
    filters.facility ||
      filters.rack ||
      filters.sku ||
      filters.batch ||
      filters.remark
  );
}

export function getFilterOptions(
  rows: InventoryTransaction[]
): FilterOptions {
  return {
    facilities: uniqueSorted(rows.map((row) => row.facility)),
    racks: uniqueSorted(rows.map((row) => row.rack)),
    skus: uniqueSorted(rows.map((row) => row.skuCode)),
    batches: uniqueSorted(rows.map((row) => row.batch)),
    remarks: uniqueSorted(rows.map((row) => row.remark))
  };
}

export function filterTransactions(
  rows: InventoryTransaction[],
  filters: DashboardFilters,
  periodStart: string,
  periodEnd: string,
  includeCurrentUndatedNtf = false
) {
  return rows.filter((row) => {
    const dateMatches = filters.date
      ? row.date === filters.date
      : (row.date >= periodStart && row.date <= periodEnd) ||
        (
          includeCurrentUndatedNtf &&
          row.sourceType === 'current' &&
          !row.date &&
          isNtfTransaction(row)
        );

    return (
      dateMatches &&
      (!filters.facility || row.facility === filters.facility) &&
      (!filters.rack || row.rack === filters.rack) &&
      (!filters.sku || row.skuCode === filters.sku) &&
      (!filters.batch || row.batch === filters.batch) &&
      (!filters.remark || row.remark === filters.remark)
    );
  });
}

export function calculateFilteredKpis(
  rows: InventoryTransaction[],
  plannedBinCount: number
): Kpis {
  let systemQuantity = 0;
  let physicalQuantity = 0;
  let absoluteDifference = 0;
  let shortQuantity = 0;
  let excessQuantity = 0;
  let systemValue = 0;
  let physicalValue = 0;
  let shortValue = 0;
  let excessValue = 0;
  let costedRowCount = 0;
  let missingCostRowCount = 0;
  const binDifferences = new Map<string, number>();
  const missingCostSkus = new Set<string>();

  rows.forEach((row) => {
    const ntfRow = isNtfTransaction(row);
    const physicalQuantityForRow = ntfRow
      ? 0
      : row.physicalQuantity;
    const differenceForRow = ntfRow
      ? 0 - row.systemQuantity
      : row.difference;

    systemQuantity += row.systemQuantity;
    physicalQuantity += physicalQuantityForRow;
    absoluteDifference += Math.abs(differenceForRow);

    if (differenceForRow < 0) {
      shortQuantity += Math.abs(differenceForRow);
    } else if (differenceForRow > 0) {
      excessQuantity += differenceForRow;
    }

    const hasCost =
      typeof row.unitCost === 'number' &&
      Number.isFinite(row.unitCost) &&
      row.unitCost >= 0;

    if (hasCost) {
      const unitCost = row.unitCost as number;
      costedRowCount += 1;
      systemValue += row.systemQuantity * unitCost;
      physicalValue += physicalQuantityForRow * unitCost;

      if (differenceForRow < 0) {
        shortValue += Math.abs(differenceForRow) * unitCost;
      } else if (differenceForRow > 0) {
        excessValue += differenceForRow * unitCost;
      }
    } else {
      missingCostRowCount += 1;
      if (row.skuCode.trim()) {
        missingCostSkus.add(row.skuCode.trim().toUpperCase());
      }
    }

    if (row.rack || row.shelf) {
      const key = [row.facility, row.rack, row.shelf].join('||');
      binDifferences.set(
        key,
        (binDifferences.get(key) || 0) + differenceForRow
      );
    }
  });

  const actualBinCount = binDifferences.size;
  const accurateBinCount = Array.from(binDifferences.values()).filter(
    (difference) => Math.abs(difference) < 0.000001
  ).length;
  const inventoryAccuracy =
    systemQuantity === 0
      ? 0
      : 100 - (absoluteDifference / systemQuantity) * 100;
  const binAccuracy =
    actualBinCount === 0
      ? 0
      : (accurateBinCount / actualBinCount) * 100;
  const completion =
    plannedBinCount === 0
      ? 0
      : (actualBinCount / plannedBinCount) * 100;
  const costCoverage =
    rows.length === 0 ? 0 : (costedRowCount / rows.length) * 100;
  const absoluteDifferenceValue = shortValue + excessValue;
  const valueAccuracy =
    systemValue === 0
      ? 0
      : 100 - (absoluteDifferenceValue / systemValue) * 100;

  return {
    inventoryAccuracy: round(inventoryAccuracy),
    inventoryAccuracyStyle: getAccuracyStyle(inventoryAccuracy),
    valueAccuracy: round(valueAccuracy),
    valueAccuracyStyle: getAccuracyStyle(valueAccuracy),
    binAccuracy: round(binAccuracy),
    binAccuracyStyle: getAccuracyStyle(binAccuracy),
    systemQuantity: round(systemQuantity),
    physicalQuantity: round(physicalQuantity),
    netDifference: round(physicalQuantity - systemQuantity),
    shortQuantity: round(shortQuantity),
    excessQuantity: round(excessQuantity),
    systemValue: round(systemValue),
    physicalValue: round(physicalValue),
    totalInventoryValue: round(systemValue),
    netDifferenceValue: round(physicalValue - systemValue),
    absoluteDifferenceValue: round(absoluteDifferenceValue),
    shortValue: round(shortValue),
    excessValue: round(excessValue),
    costCoverage: round(costCoverage),
    costedRowCount,
    missingCostRowCount,
    missingCostSkuCount: missingCostSkus.size,
    plannedBinCount: round(plannedBinCount),
    actualBinCount,
    cycleCountCompletion: round(completion)
  };
}

/**
 * Returns true when Rack, Shelf, or Remark marks a transaction as NTF.
 * A row is evaluated once, so NTF in more than one field is not double-counted.
 */
export function isNtfTransaction(row: InventoryTransaction) {
  return [row.rack, row.shelf, row.remark].some((value) =>
    /NTF/i.test(value || '')
  );
}

export function getAccuracyStyle(value: number): AccuracyStyle {
  if (value < 96) {
    return {
      name: 'Red',
      text: '#991b1b',
      background: '#fee2e2',
      indicator: '#dc2626'
    };
  }

  if (value < 99) {
    return {
      name: 'Yellow',
      text: '#854d0e',
      background: '#fef9c3',
      indicator: '#eab308'
    };
  }

  return {
    name: 'Green',
    text: '#166534',
    background: '#dcfce7',
    indicator: '#16a34a'
  };
}

function uniqueSorted(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  ).sort((first, second) =>
    first.localeCompare(second, undefined, {
      numeric: true,
      sensitivity: 'base'
    })
  );
}

function round(value: number) {
  return Number.isFinite(value)
    ? Math.round((value + Number.EPSILON) * 100) / 100
    : 0;
}
