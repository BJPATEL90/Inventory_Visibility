import { RotateCcw } from 'lucide-react';
import type {
  DashboardFilters,
  FilterOptions
} from '../types';

interface FilterBarProps {
  filters: DashboardFilters;
  options: FilterOptions;
  onChange: (name: keyof DashboardFilters, value: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

interface SelectFilterProps {
  label: string;
  value: string;
  placeholder: string;
  options: string[];
  onChange: (value: string) => void;
}

function SelectFilter({
  label,
  value,
  placeholder,
  options,
  onChange
}: SelectFilterProps) {
  return (
    <label className="min-w-0">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterBar({
  filters,
  options,
  onChange,
  onClear,
  disabled = false
}: FilterBarProps) {
  return (
    <section className="sticky top-0 z-30 border-y border-slate-200 bg-white/95 py-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
      <div
        className={`mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 ${
          disabled ? 'pointer-events-none opacity-60' : ''
        }`}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <label className="min-w-0">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Date
            </span>
            <input
              type="date"
              value={filters.date}
              onChange={(event) => onChange('date', event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>

          <SelectFilter
            label="Facility"
            value={filters.facility}
            placeholder="All facilities"
            options={options.facilities}
            onChange={(value) => onChange('facility', value)}
          />
          <SelectFilter
            label="Rack"
            value={filters.rack}
            placeholder="All racks"
            options={options.racks}
            onChange={(value) => onChange('rack', value)}
          />
          <SelectFilter
            label="SKU"
            value={filters.sku}
            placeholder="All SKUs"
            options={options.skus}
            onChange={(value) => onChange('sku', value)}
          />
          <SelectFilter
            label="Batch"
            value={filters.batch}
            placeholder="All batches"
            options={options.batches}
            onChange={(value) => onChange('batch', value)}
          />
          <SelectFilter
            label="Remark"
            value={filters.remark}
            placeholder="All remarks"
            options={options.remarks}
            onChange={(value) => onChange('remark', value)}
          />

          <div className="flex items-end">
            <button
              type="button"
              onClick={onClear}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-blue-700 dark:hover:bg-blue-950/50"
            >
              <RotateCcw aria-hidden="true" className="h-4 w-4" />
              Clear filters
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
