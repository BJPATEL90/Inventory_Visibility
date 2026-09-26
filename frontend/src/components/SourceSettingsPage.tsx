import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  History,
  Save
} from 'lucide-react';
import type { SourceSettingsData } from '../types';

interface SourceSettingsPageProps {
  data?: SourceSettingsData;
  isLoading: boolean;
  isSaving: boolean;
  errorMessage: string;
  saveMessage: string;
  onRetry: () => void;
  onSave: (spreadsheetReference: string, effectiveFrom: string) => void;
}

function formatDate(value: string) {
  if (!value) return 'Ongoing';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

export function SourceSettingsPage({
  data,
  isLoading,
  isSaving,
  errorMessage,
  saveMessage,
  onRetry,
  onSave
}: SourceSettingsPageProps) {
  const [spreadsheetReference, setSpreadsheetReference] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');

  useEffect(() => {
    if (data?.suggestedEffectiveFrom && !effectiveFrom) {
      setEffectiveFrom(data.suggestedEffectiveFrom);
    }
  }, [data?.suggestedEffectiveFrom, effectiveFrom]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(spreadsheetReference.trim(), effectiveFrom);
  }

  if (isLoading && !data) {
    return (
      <section className="rounded-2xl border border-blue-200 bg-blue-50 px-6 py-12 text-center dark:border-blue-900 dark:bg-blue-950/30">
        <FileSpreadsheet className="mx-auto h-10 w-10 animate-pulse text-blue-600" />
        <p className="mt-4 font-semibold">Loading source settings...</p>
      </section>
    );
  }

  if (errorMessage && !data) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 px-6 py-10 text-center dark:border-red-900 dark:bg-red-950/30">
        <AlertCircle className="mx-auto h-10 w-10 text-red-600" />
        <h2 className="mt-4 text-lg font-bold">Source settings unavailable</h2>
        <p className="mt-2 text-sm text-red-800 dark:text-red-200">{errorMessage}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </section>
    );
  }

  const activeSource = data?.activeSource;

  return (
    <section>
      <div className="mb-6">
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
          Settings
        </p>
        <h2 className="mt-1 text-2xl font-extrabold tracking-tight">
          Cycle-count source
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          Schedule the Google Sheet used for B2C, OWN, and SL_Export. Earlier
          sources remain attached to their original dates, so changing the
          source does not remove prior-quarter transactions.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.8fr)]">
        <div className="space-y-5">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  Active source
                </p>
                <h3 className="mt-1 truncate text-lg font-bold">
                  {activeSource?.spreadsheetName || 'Not configured'}
                </h3>
                {activeSource ? (
                  <>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Effective {formatDate(activeSource.effectiveFrom)}
                      {activeSource.effectiveUntil
                        ? ` to ${formatDate(activeSource.effectiveUntil)}`
                        : ' onward'}
                    </p>
                    <a
                      href={activeSource.spreadsheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300"
                    >
                      Open Google Sheet
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </>
                ) : null}
              </div>
            </div>
          </article>

          <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <History className="h-5 w-5 text-blue-600" />
              <div>
                <h3 className="font-bold">Source history</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  The correct workbook is selected from each transaction date.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Workbook</th>
                    <th className="px-5 py-3">Effective from</th>
                    <th className="px-5 py-3">Effective until</th>
                    <th className="px-5 py-3">Updated by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(data?.schedule || []).map((source) => (
                    <tr key={`${source.effectiveFrom}-${source.spreadsheetId}`}>
                      <td className="px-5 py-3 font-semibold">
                        <a
                          href={source.spreadsheetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-blue-700 hover:underline dark:text-blue-300"
                        >
                          {source.spreadsheetName}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </td>
                      <td className="px-5 py-3">{formatDate(source.effectiveFrom)}</td>
                      <td className="px-5 py-3">{formatDate(source.effectiveUntil)}</td>
                      <td className="px-5 py-3 text-slate-500 dark:text-slate-400">
                        {source.updatedBy || 'System'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <form
          onSubmit={submit}
          className="h-fit rounded-2xl border border-blue-200 bg-white p-5 shadow-sm dark:border-blue-900 dark:bg-slate-900"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-bold">Schedule a new source</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                The workbook is validated before it is saved.
              </p>
            </div>
          </div>

          <label className="mt-6 block text-sm font-semibold" htmlFor="source-sheet">
            Google Sheets URL or spreadsheet ID
          </label>
          <input
            id="source-sheet"
            type="text"
            value={spreadsheetReference}
            onChange={(event) => setSpreadsheetReference(event.target.value)}
            placeholder="Paste the new Google Sheets link"
            required
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950"
          />

          <label className="mt-5 block text-sm font-semibold" htmlFor="effective-date">
            Effective from
          </label>
          <div className="relative mt-2">
            <CalendarDays className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
            <input
              id="effective-date"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              required
              className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-3.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="mt-5 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
            Required tabs: <strong>{(data?.sourceSheets || []).join(', ')}</strong>.
            Saving a future date does not change today&apos;s dashboard. On the
            effective date, Refresh and scheduled processing use the new source.
          </div>

          {errorMessage ? (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
              {errorMessage}
            </p>
          ) : null}
          {saveMessage ? (
            <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
              {saveMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSaving || !spreadsheetReference.trim() || !effectiveFrom}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4.5 w-4.5" />
            {isSaving ? 'Validating and saving...' : 'Validate and save source'}
          </button>
        </form>
      </div>
    </section>
  );
}
