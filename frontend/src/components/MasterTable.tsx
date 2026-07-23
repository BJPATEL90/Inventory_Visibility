import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  Search
} from 'lucide-react';

type SortDirection = 'asc' | 'desc';

export interface MasterColumn<T extends object> {
  key: keyof T;
  label: string;
  numeric?: boolean;
  className?: string;
}

interface MasterTableProps<T extends object> {
  title: string;
  description: string;
  emptyMessage: string;
  rows: T[];
  columns: MasterColumn<T>[];
}

function compareText(
  first: unknown,
  second: unknown,
  direction: SortDirection
) {
  const result = String(first ?? '').localeCompare(
    String(second ?? ''),
    undefined,
    {
      numeric: true,
      sensitivity: 'base'
    }
  );

  return direction === 'asc' ? result : -result;
}

export function MasterTable<T extends object>({
  title,
  description,
  emptyMessage,
  rows,
  columns
}: MasterTableProps<T>) {
  const [searchText, setSearchText] = useState('');
  const [sortKey, setSortKey] = useState<keyof T>(columns[0].key);
  const [sortDirection, setSortDirection] =
    useState<SortDirection>('asc');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const searchedAndSortedRows = useMemo(() => {
    const search = searchText.trim().toLowerCase();
    const searchedRows = search
      ? rows.filter((row) =>
          Object.values(row)
            .join(' ')
            .toLowerCase()
            .includes(search)
        )
      : [...rows];

    return searchedRows.sort((first, second) =>
      compareText(
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

  function changeSort(nextKey: keyof T) {
    if (sortKey === nextKey) {
      setSortDirection((current) =>
        current === 'asc' ? 'desc' : 'asc'
      );
    } else {
      setSortKey(nextKey);
      setSortDirection('asc');
    }
  }

  function renderValue(row: T, column: MasterColumn<T>) {
    const text = String(row[column.key] ?? '').trim();

    if (String(column.key).toLowerCase() === 'status' && text) {
      const active = text.toLowerCase() === 'active';
      return (
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
            active
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {text}
        </span>
      );
    }

    return text || '—';
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-950 dark:text-white">
              {title}
            </h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <LockKeyhole className="h-3 w-3" />
              Read only
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            {description}
          </p>
        </div>

        <label className="relative w-full sm:w-72">
          <span className="sr-only">Search {title}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={`Search ${title.toLowerCase()}...`}
            disabled={rows.length === 0}
            className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-950/70">
            <tr>
              {columns.map((column) => (
                <th
                  key={String(column.key)}
                  scope="col"
                  className={`border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400 ${
                    column.numeric ? 'text-right' : ''
                  } ${column.className || ''}`}
                >
                  <button
                    type="button"
                    onClick={() => changeSort(column.key)}
                    className="inline-flex items-center gap-1.5 transition hover:text-blue-700 focus:outline-none dark:hover:text-blue-300"
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
                  className="px-4 py-12 text-center text-slate-500 dark:text-slate-400"
                >
                  {rows.length === 0
                    ? emptyMessage
                    : 'No master rows match the search.'}
                </td>
              </tr>
            ) : (
              pageRows.map((row, rowIndex) => (
                <tr
                  key={`${title}-${safePage}-${rowIndex}-${columns
                    .map((column) => String(row[column.key] ?? ''))
                    .join('-')}`}
                  className="transition hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
                >
                  {columns.map((column) => (
                    <td
                      key={String(column.key)}
                      className={`whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-300 ${
                        column.numeric
                          ? 'text-right font-medium tabular-nums'
                          : ''
                      } ${column.className || ''}`}
                    >
                      {renderValue(row, column)}
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
          Showing {firstVisibleRow}–{lastVisibleRow} of{' '}
          {searchedAndSortedRows.length}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            Rows
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {[10, 25, 50].map((size) => (
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
            aria-label={`Previous ${title} page`}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={safePage === 1}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 transition hover:border-blue-400 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={`Next ${title} page`}
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
    </article>
  );
}
