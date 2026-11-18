'use client';

import { FileSpreadsheet, Loader2, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import { apiPost, fileToBase64 } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fileSize } from '@/lib/format';
import { ErrorNote } from './ui';

const MAX_BYTES = 4 * 1024 * 1024;

/** Uploads an .xlsx to /api/imports and hands back the parsed sheet summary. */
export function WorkbookDropzone({ onUploaded, hint }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function handle(file) {
    if (!file) return;
    setError(null);
    if (!/\.xlsx$/i.test(file.name)) {
      setError(new Error('Only .xlsx files are supported.'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(new Error(`File is ${fileSize(file.size)}; max 4 MB.`));
      return;
    }
    setBusy(file);
    try {
      const result = await apiPost('/api/imports', { fileName: file.name, contentBase64: await fileToBase64(file) }, { timeoutMs: 60_000 });
      onUploaded(result);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={Boolean(busy)}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handle(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          'group flex w-full flex-col items-center rounded-xl border-[1.5px] border-dashed px-6 py-10 text-center transition-colors',
          dragging ? 'border-ember-500 bg-ember-50' : 'border-line-strong bg-paper hover:border-ink-4 hover:bg-sand/50',
        )}
      >
        {busy ? (
          <>
            <div className="grid size-12 place-items-center rounded-2xl bg-surface text-ember-600 shadow-card">
              <Loader2 className="size-5 animate-spin" />
            </div>
            <div className="mt-4 flex items-center gap-2 text-[14px] font-medium text-ink">
              <FileSpreadsheet className="size-4 text-moss" /> {busy.name}
            </div>
            <div className="mt-1 text-[12.5px] text-ink-3">Reading…</div>
          </>
        ) : (
          <>
            <div className="grid size-12 place-items-center rounded-2xl bg-surface text-ink-2 shadow-card transition-transform group-hover:-translate-y-0.5">
              <UploadCloud className="size-5" />
            </div>
            <div className="mt-4 text-[14px] font-medium text-ink">
              Drop .xlsx or <span className="text-ember-600">browse</span>
            </div>
            <div className="mt-1 text-[12.5px] text-ink-3">{hint ?? 'Max 4 MB'}</div>
          </>
        )}
      </button>
      <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => handle(e.target.files?.[0])} />
      <ErrorNote error={error} className="mt-3" />
    </div>
  );
}

const KIND = { payroll: 'Payroll register', master: 'Employee master', other: 'Other' };

export function SheetPicker({ sheets, value, onChange, preferKind }) {
  return (
    <div className="grid gap-2" role="radiogroup">
      {sheets.map((sheet) => {
        const selected = sheet.name === value;
        const fits = !preferKind || sheet.kind === preferKind;
        return (
          <button
            key={sheet.name}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(sheet.name)}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all',
              selected ? 'border-ink bg-surface ring-1 ring-ink' : 'border-line bg-surface hover:border-line-strong',
              !fits && !selected && 'opacity-60',
            )}
          >
            <span className={cn('grid size-4 shrink-0 place-items-center rounded-full border', selected ? 'border-ink' : 'border-line-strong')}>
              {selected && <span className="size-2 rounded-full bg-ink" />}
            </span>
            <FileSpreadsheet className={cn('size-4 shrink-0', sheet.kind === 'payroll' ? 'text-moss' : 'text-ink-4')} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink">{sheet.name}</span>
              <span className="block text-[12px] text-ink-3">
                {KIND[sheet.kind]} · <span className="num">{sheet.rowCount}</span> rows
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
