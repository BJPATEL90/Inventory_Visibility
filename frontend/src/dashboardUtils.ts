import type {
  AccuracyStyle,
  DashboardChartData,
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
  periodEnd: string
) {
  return rows.filter((row) => {
    const dateMatches = filters.date
      ? row.date === filters.date
      : row.date >= periodStart && row.date <= periodEnd;

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
  let ntfCount = 0;
  const binDifferences = new Map<string, number>();
  const missingCostSkus = new Set<string>();

  rows.forEach((row) => {
    systemQuantity += row.systemQuantity;
    physicalQuantity += row.physicalQuantity;
    absoluteDifference += Math.abs(row.difference);

    if (row.difference < 0) {
      shortQuantity += Math.abs(row.difference);
    } else if (row.difference > 0) {
      excessQuantity += row.difference;
    }

    const hasCost =
      typeof row.unitCost === 'number' &&
      Number.isFinite(row.unitCost) &&
      row.unitCost >= 0;

    if (hasCost) {
      const unitCost = row.unitCost as number;
      costedRowCount += 1;
      systemValue += row.systemQuantity * unitCost;
      physicalValue += row.physicalQuantity * unitCost;

      if (row.difference < 0) {
        shortValue += Math.abs(row.difference) * unitCost;
      } else if (row.difference > 0) {
        excessValue += row.difference * unitCost;
      }
    } else {
      missingCostRowCount += 1;
      if (row.skuCode.trim()) {
        missingCostSkus.add(row.skuCode.trim().toUpperCase());
      }
    }

    if (/NTF/i.test(row.remark)) {
      ntfCount += 1;
    }

    if (row.rack || row.shelf) {
      const key = [row.facility, row.rack, row.shelf].join('||');
      binDifferences.set(
        key,
        (binDifferences.get(key) || 0) + row.difference
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

  return {
    inventoryAccuracy: round(inventoryAccuracy),
    inventoryAccuracyStyle: getAccuracyStyle(inventoryAccuracy),
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
    shortValue: round(shortValue),
    excessValue: round(excessValue),
    costCoverage: round(costCoverage),
    costedRowCount,
    missingCostRowCount,
    missingCostSkuCount: missingCostSkus.size,
    plannedBinCount: round(plannedBinCount),
    actualBinCount,
    cycleCountCompletion: round(completion),
    ntfCount
  };
}

export function calculateCharts(
  rows: InventoryTransaction[]
): DashboardChartData {
  const rowsByDate = new Map<string, InventoryTransaction[]>();
  const rowsByFacility = new Map<string, InventoryTransaction[]>();

  rows.forEach((row) => {
    if (row.date) {
      const dateRows = rowsByDate.get(row.date) || [];
      dateRows.push(row);
      rowsByDate.set(row.date, dateRows);
    }

    if (row.facility) {
      const facilityRows = rowsByFacility.get(row.facility) || [];
      facilityRows.push(row);
      rowsByFacility.set(row.facility, facilityRows);
    }
  });

  const dates = Array.from(rowsByDate.keys()).sort();
  const facilities = Array.from(rowsByFacility.keys()).sort((first, second) =>
    first.localeCompare(second, undefined, {
      numeric: true,
      sensitivity: 'base'
    })
  );
  const inventoryAccuracyValues = dates.map((date) =>
    inventoryAccuracyForRows(rowsByDate.get(date) || [])
  );

  return {
    inventoryAccuracyTrend: {
      categories: dates,
      values: inventoryAccuracyValues,
      pointColors: inventoryAccuracyValues.map(
        (value) => getAccuracyStyle(value).indicator
      )
    },
    binAccuracyTrend: {
      categories: dates,
      values: dates.map((date) =>
        binAccuracyForRows(rowsByDate.get(date) || [])
      )
    },
    facilityInventoryAccuracy: {
      categories: facilities,
      values: facilities.map((facility) =>
        inventoryAccuracyForRows(rowsByFacility.get(facility) || [])
      ),
      pointColors: facilities.map((facility) =>
        getAccuracyStyle(
          inventoryAccuracyForRows(rowsByFacility.get(facility) || [])
        ).indicator
      )
    },
    ntfTrend: {
      categories: dates,
      values: dates.map(
        (date) =>
          (rowsByDate.get(date) || []).filter((row) =>
            /NTF/i.test(row.remark)
          ).length
      )
    }
  };
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

function inventoryAccuracyForRows(rows: InventoryTransaction[]) {
  const systemQuantity = rows.reduce(
    (total, row) => total + row.systemQuantity,
    0
  );
  const absoluteDifference = rows.reduce(
    (total, row) => total + Math.abs(row.difference),
    0
  );

  return round(
    systemQuantity === 0
      ? 0
      : 100 - (absoluteDifference / systemQuantity) * 100
  );
}

function binAccuracyForRows(rows: InventoryTransaction[]) {
  const binDifferences = new Map<string, number>();

  rows.forEach((row) => {
    if (!row.rack && !row.shelf) {
      return;
    }

    const key = [row.facility, row.rack, row.shelf].join('||');
    binDifferences.set(
      key,
      (binDifferences.get(key) || 0) + row.difference
    );
  });

  if (binDifferences.size === 0) {
    return 0;
  }

  const accurateBins = Array.from(binDifferences.values()).filter(
    (difference) => Math.abs(difference) < 0.000001
  ).length;

  return round((accurateBins / binDifferences.size) * 100);
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
