import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Table2
} from 'lucide-react';
import type { InventoryTransaction } from '../types';

type SortDirection = 'asc' | 'desc';
type SortKey =
  | 'date'
  | 'facility'
  | 'rack'
  | 'skuCode'
  | 'itemName'
  | 'shelf'
  | 'batch'
  | 'vendorBatchNumber'
  | 'unitCost'
  | 'systemQuantity'
  | 'physicalQuantity'
  | 'difference'
  | 'systemValue'
  | 'physicalValue'
  | 'differenceValue'
  | 'remark';

interface InventoryTableProps {
  rows: InventoryTransaction[];
}

interface ColumnDefinition {
  key: SortKey;
  label: string;
  numeric?: boolean;
  className?: string;
}

const columns: ColumnDefinition[] = [
  { key: 'date', label: 'Date' },
  { key: 'facility', label: 'Facility' },
  { key: 'rack', label: 'Rack' },
  { key: 'skuCode', label: 'SKU' },
  {
    key: 'itemName',
    label: 'Item Name',
    className: 'min-w-64'
  },
  { key: 'shelf', label: 'Shelf' },
  { key: 'batch', label: 'Batch' },
  {
    key: 'vendorBatchNumber',
    label: 'Vendor Batch',
    className: 'min-w-36'
  },
  { key: 'unitCost', label: 'Unit Cost', numeric: true },
  { key: 'systemQuantity', label: 'System Qty', numeric: true },
  { key: 'physicalQuantity', label: 'Physical Qty', numeric: true },
  { key: 'difference', label: 'Difference', numeric: true },
  { key: 'systemValue', label: 'System Value', numeric: true },
  { key: 'physicalValue', label: 'Physical Value', numeric: true },
  { key: 'differenceValue', label: 'Difference Value', numeric: true },
  {
    key: 'remark',
    label: 'Remark',
    className: 'min-w-32'
  }
];

const numberFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2
});

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2
});

function formatDate(value: string) {
  if (!value) {
    return '—';
  }

  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }).format(date);
}

function compareValues(
  first: string | number | null,
  second: string | number | null,
  direction: SortDirection
) {
  const multiplier = direction === 'asc' ? 1 : -1;

  if (first === null && second === null) {
    return 0;
  }

  if (first === null) {
    return 1;
  }

  if (second === null) {
    return -1;
  }

  if (typeof first === 'number' && typeof second === 'number') {
    return (first - second) * multiplier;
  }

  return (
    String(first).localeCompare(String(second), undefined, {
      numeric: true,
      sensitivity: 'base'
    }) * multiplier
  );
}

function csvCell(value: string | number | null) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function InventoryTable({ rows }: InventoryTableProps) {
  const [searchText, setSearchText] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDirection, setSortDirection] =
    useState<SortDirection>('desc');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const searchedAndSortedRows = useMemo(() => {
    const search = searchText.trim().toLowerCase();
    const searchedRows = search
      ? rows.filter((row) =>
          [
            row.date,
            row.facility,
            row.rack,
            row.skuCode,
            row.itemName,
            row.shelf,
            row.batch,
            row.vendorBatchNumber,
            row.unitCost,
            row.systemQuantity,
            row.physicalQuantity,
            row.difference,
            row.systemValue,
            row.physicalValue,
            row.differenceValue,
            row.remark
          ]
            .join(' ')
            .toLowerCase()
            .includes(search)
        )
      : [...rows];

    return searchedRows.sort((first, second) =>
      compareValues(
        first[sortKey],
        second[sortKey],
        sortDirection
      )
    );
  }, [rows, searchText, sortDirection, sortKey]);

  const pageCount = Math.max(
    1,
    Math.ceil(searchedAndSortedRows.length / pageSize)
  );
  const safePage = Math.min(page, pageCount);
  const pageRows = searchedAndSortedRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );
  const firstVisibleRow =
    searchedAndSortedRows.length === 0
      ? 0
      : (safePage - 1) * pageSize + 1;
  const lastVisibleRow = Math.min(
    safePage * pageSize,
    searchedAndSortedRows.length
  );

  useEffect(() => {
    setPage(1);
  }, [pageSize, rows, searchText, sortDirection, sortKey]);

  function changeSort(nextSortKey: SortKey) {
    if (sortKey === nextSortKey) {
      setSortDirection((current) =>
        current === 'asc' ? 'desc' : 'asc'
      );
    } else {
      setSortKey(nextSortKey);
      setSortDirection('asc');
    }
  }

  function exportCsv() {
    const headers = columns.map((column) => csvCell(column.label));
    const dataRows = searchedAndSortedRows.map((row) =>
      [
        row.date,
        row.facility,
        row.rack,
        row.skuCode,
        row.itemName,
        row.shelf,
        row.batch,
        row.vendorBatchNumber,
        row.unitCost,
        row.systemQuantity,
        row.physicalQuantity,
        row.difference,
        row.systemValue,
        row.physicalValue,
        row.differenceValue,
        row.remark
      ]
        .map(csvCell)
        .join(',')
    );
    const csv = `\uFEFF${[headers.join(','), ...dataRows].join('\r\n')}`;
    const blob = new Blob([csv], {
      type: 'text/csv;charset=utf-8'
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = downloadUrl;
    link.download = `inventory-transactions-${
      new Date().toISOString().slice(0, 10)
    }.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  }

  function renderCell(
    row: InventoryTransaction,
    column: ColumnDefinition
  ) {
    if (column.key === 'date') {
      return formatDate(row.date);
    }

    if (
      column.key === 'systemQuantity' ||
      column.key === 'physicalQuantity'
    ) {
      return numberFormatter.format(row[column.key]);
    }

    if (column.key === 'difference') {
      const difference = row.difference;
      const differenceClass =
        difference < 0
          ? 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
          : difference > 0
            ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300';

      return (
        <span
          className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${differenceClass}`}
        >
          {numberFormatter.format(difference)}
        </span>
      );
    }

    if (
      column.key === 'unitCost' ||
      column.key === 'systemValue' ||
      column.key === 'physicalValue'
    ) {
      const value = row[column.key];
      return value === null ? (
        <span className="text-xs font-semibold text-red-600 dark:text-red-400">
          Missing cost
        </span>
      ) : (
        currencyFormatter.format(value)
      );
    }

    if (column.key === 'differenceValue') {
      const value = row.differenceValue;

      if (value === null) {
        return (
          <span className="text-xs font-semibold text-red-600 dark:text-red-400">
            Missing cost
          </span>
        );
      }

      const valueClass =
        value < 0
          ? 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
          : value > 0
            ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300';

      return (
        <span
          className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${valueClass}`}
        >
          {currencyFormatter.format(value)}
        </span>
      );
    }

    const value = row[column.key];
    return value === '' ? '—' : String(value);
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-5 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
            <Table2 aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-semibold text-slate-950 dark:text-white">
              Inventory Transactions
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Search, sort, review, and export the current filtered rows.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative min-w-0 sm:w-72">
            <span className="sr-only">Search inventory transactions</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search all columns..."
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <button
            type="button"
            onClick={exportCsv}
            disabled={searchedAndSortedRows.length === 0}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[2050px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-950/70">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400 ${
                    column.numeric ? 'text-right' : ''
                  } ${column.className || ''}`}
                >
                  <button
                    type="button"
                    onClick={() => changeSort(column.key)}
                    className={`inline-flex items-center gap-1.5 transition hover:text-blue-700 focus:outline-none dark:hover:text-blue-300 ${
                      column.numeric ? 'justify-end' : ''
                    }`}
                  >
                    {column.label}
                    {sortKey !== column.key ? (
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    ) : sortDirection === 'asc' ? (
                      <ArrowUp className="h-3.5 w-3.5 text-blue-600" />
                    ) : (
                      <ArrowDown className="h-3.5 w-3.5 text-blue-600" />
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-14 text-center text-slate-500 dark:text-slate-400"
                >
                  No transactions match the table search.
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr
                  key={row.id}
                  className="transition hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-300 ${
                        column.numeric
                          ? 'text-right font-medium tabular-nums'
                          : ''
                      } ${column.className || ''}`}
                    >
                      {renderCell(row, column)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-4 border-t border-slate-200 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Showing {numberFormatter.format(firstVisibleRow)}–
          {numberFormatter.format(lastVisibleRow)} of{' '}
          {numberFormatter.format(searchedAndSortedRows.length)}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            Rows
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Page {safePage} of {pageCount}
          </span>
          <button
            type="button"
            aria-label="Previous page"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={safePage === 1}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 transition hover:border-blue-400 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next page"
            onClick={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
            disabled={safePage === pageCount}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 transition hover:border-blue-400 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
