'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Download, FileSpreadsheet, Minus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiPost } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fileSize, periodLabel } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { Button } from './shadcn/button';
import { Dialog, DialogContent, DialogFooter } from './shadcn/dialog';
import { Input } from './shadcn/input';
import { ErrorNote, Field } from './ui';
import { SheetPicker, WorkbookDropzone } from './workbook-dropzone';

const GROUPS = [
  { title: 'Employee', keys: ['employeeId', 'name', 'designation', 'joiningDate', 'exitDate', 'officialEmail', 'personalEmail'] },
  { title: 'Attendance', keys: ['monthStart', 'payrollDate', 'workingDays', 'paidLeaves', 'lop', 'daysInMonth', 'pctSalary'] },
  { title: 'Earnings · monthly rate', keys: ['ctc', 'basic', 'hra', 'monthlyAllowance', 'lta', 'performance', 'telephone', 'fuel', 'specialBonus'] },
  { title: 'Earnings · payable', keys: ['basicPayable', 'hraPayable', 'monthlyAllowancePayable', 'ltaPayable', 'performancePayable', 'telephonePayable', 'fuelPayable', 'specialBonusPayable', 'grossEarnings'] },
  { title: 'Deductions & net', keys: ['pfEmployee', 'professionalTax', 'tds', 'openingAdvance', 'advanceDeducted', 'closingAdvance', 'totalDeductions', 'netPay', 'amountWords'] },
];
const REQUIRED = new Set(['employeeId', 'netPay']);
const DERIVABLE = new Set(['basicPayable', 'hraPayable', 'monthlyAllowancePayable', 'ltaPayable', 'performancePayable', 'telephonePayable', 'fuelPayable', 'specialBonusPayable', 'grossEarnings', 'totalDeductions', 'amountWords']);

function MappingPreview({ sheet }) {
  const byKey = useMemo(() => new Map(sheet.mapping.map((m) => [m.key, m])), [sheet]);
  const matched = sheet.mapping.filter((m) => m.column).length;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="eyebrow">Columns</div>
        <div className="num text-[12px] text-ink-3">{matched}/{sheet.mapping.length}</div>
      </div>
      <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <div className="mb-1.5 text-[12px] font-medium text-ink-2">{group.title}</div>
            <ul className="space-y-0.5">
              {group.keys.map((key) => {
                const m = byKey.get(key);
                if (!m) return null;
                const missingRequired = !m.column && REQUIRED.has(key);
                return (
                  <li key={key} className="flex items-center gap-2 text-[12.5px]">
                    {m.column ? (
                      <Check className="size-3.5 shrink-0 text-moss" />
                    ) : (
                      <Minus className={cn('size-3.5 shrink-0', missingRequired ? 'text-rust' : 'text-ink-4')} />
                    )}
                    <span className={cn('truncate', m.column ? 'text-ink' : missingRequired ? 'font-medium text-rust' : 'text-ink-4')}>{m.label}</span>
                    {!m.column && DERIVABLE.has(key) && <span className="shrink-0 text-[11px] text-ink-4">· derived</span>}
                    {m.column && m.column !== m.label && <span className="ml-auto max-w-[45%] truncate font-mono text-[11px] text-ink-3" title={m.column}>{m.column}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {sheet.unmappedColumns.length > 0 && (
        <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
          <span className="font-medium text-ink-2">Ignored:</span> {sheet.unmappedColumns.join(', ')}
        </p>
      )}
    </div>
  );
}

export function NewRunDialog({ open, onOpenChange, onCreated }) {
  const queryClient = useQueryClient();
  const [upload, setUpload] = useState(null);
  const [sheetName, setSheetName] = useState('');
  const [period, setPeriod] = useState('');

  const sheet = upload?.sheets.find((s) => s.name === sheetName);
  const missingRequired = sheet && sheet.mapping.filter((m) => REQUIRED.has(m.key) && !m.column);

  const create = useMutation({
    mutationFn: () => apiPost('/api/payroll-runs', { importId: upload.id, sheetName, period }, { timeoutMs: 60_000 }),
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: qk.runs });
      toast.success(`Draft run created for ${periodLabel(period)}`);
      reset();
      onCreated(id);
    },
  });

  function reset() {
    setUpload(null);
    setSheetName('');
    setPeriod('');
    create.reset();
  }

  function chooseSheet(name, summary = upload) {
    setSheetName(name);
    const s = summary.sheets.find((x) => x.name === name);
    if (s?.suggestedPeriod) setPeriod(s.suggestedPeriod);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent
        title={upload ? 'Review the register' : 'New payroll run'}
        className={cn(upload && 'sm:max-w-3xl')}
      >
        <AnimatePresence mode="wait" initial={false}>
          {!upload ? (
            <motion.div key="upload" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="px-6 pb-6 pt-4">
              <div className="mb-3 flex justify-end">
                <Button asChild size="sm" variant="ghost">
                  <a href="/templates/Keystone_Payroll_Template.xlsx" download><Download /> Download template</a>
                </Button>
              </div>
              <WorkbookDropzone
                onUploaded={(result) => {
                  setUpload(result);
                  if (result.defaultSheet) chooseSheet(result.defaultSheet, result);
                }}
              />
            </motion.div>
          ) : (
            <motion.div key="review" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="grid gap-6 px-6 pb-6 pt-4 md:grid-cols-[260px_minmax(0,1fr)]">
                <div className="space-y-5">
                  <div className="flex items-center gap-2.5 rounded-xl bg-paper px-3 py-2.5">
                    <FileSpreadsheet className="size-4 shrink-0 text-moss" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{upload.fileName}</div>
                      <div className="text-[11.5px] text-ink-3">{fileSize(upload.fileSize)} · {upload.sheets.length} sheets</div>
                    </div>
                    <button onClick={reset} className="text-[12px] font-medium text-ember-600 hover:underline">Change</button>
                  </div>
                  <Field label="Sheet">
                    <SheetPicker sheets={upload.sheets} value={sheetName} onChange={(n) => chooseSheet(n)} preferKind="payroll" />
                  </Field>
                  <Field label="Payroll month" htmlFor="period">
                    <Input id="period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
                  </Field>
                </div>
                <div className="min-w-0 rounded-xl border border-line p-4">
                  {sheet ? <MappingPreview sheet={sheet} /> : <p className="text-[13px] text-ink-3">Choose a sheet.</p>}
                </div>
              </div>
              {(missingRequired?.length > 0 || create.error) && (
                <div className="px-6 pb-4">
                  {missingRequired?.length > 0 && (
                    <ErrorNote error={{ message: `Missing column: ${missingRequired.map((m) => m.label).join(', ')}` }} />
                  )}
                  <ErrorNote error={create.error} />
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => onOpenChange(false)} variant="ghost">Cancel</Button>
                <Button
                  variant="primary"
                  loading={create.isPending}
                  disabled={!sheet || !period || missingRequired?.length > 0}
                  onClick={() => create.mutate()}
                >
                  Create draft{sheet ? ` · ${sheet.rowCount} employees` : ''}
                </Button>
              </DialogFooter>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
