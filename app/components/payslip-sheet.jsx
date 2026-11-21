'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Download, History, Mail, PencilLine, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { PERM, useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { dateTime, money } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { Button } from './shadcn/button';
import { Dialog, SheetContent } from './shadcn/dialog';
import { Input } from './shadcn/input';
import { EmailStatus, ErrorNote, Field, SeverityIcon, Skeleton } from './ui';

const FIELD_LABELS = {
  basicPayable: 'Basic payable', hraPayable: 'HRA payable', monthlyAllowancePayable: 'Monthly allowance payable',
  ltaPayable: 'LTA payable', performancePayable: 'Performance payable', telephonePayable: 'Telephone payable',
  fuelPayable: 'Fuel payable', specialBonusPayable: 'Special bonus payable', grossEarnings: 'Gross earnings',
  totalDeductions: 'Total deductions', amountWords: 'Amount in words',
};

function Section({ title, children, defaultOpen = true, aside }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-line">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-5 py-3 text-left">
        <span className="eyebrow">{title}</span>
        <span className="flex items-center gap-2 text-[12px] text-ink-3">
          {aside}
          <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} />
        </span>
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </section>
  );
}

// Fields the audit can flag, in display order. Only flagged ones are offered for editing.
const CORRECTABLE = [
  { key: 'employeeId', label: 'Employee ID', checks: ['Duplicate Employee ID'] },
  { key: 'name', label: 'Full name', checks: ['Missing Full Name'] },
  { key: 'netPay', label: 'Net pay (₹)', checks: ['Missing Net Pay', 'Negative Net Pay', 'Unreadable Net Pay', 'Net Pay mismatch'], money: true, inputMode: 'decimal' },
  { key: 'designation', label: 'Designation', checks: ['Missing Designation'] },
  { key: 'officialEmail', label: 'Official email', checks: ['Unreadable Official Email'], type: 'email' },
  { key: 'personalEmail', label: 'Personal email', checks: ['Unreadable Personal Email'], type: 'email' },
];
const CORRECTABLE_BY_KEY = Object.fromEntries(CORRECTABLE.map((f) => [f.key, f]));
const fieldOf = (issue) => issue.field ?? CORRECTABLE.find((f) => f.checks.includes(issue.check))?.key ?? null;
const shown = (field, value) => (value === null || value === undefined ? '' : field.money ? String(value / 100) : String(value));

function flaggedFields(issues) {
  const keys = new Set(issues.filter((i) => i.severity !== 'info').map(fieldOf).filter(Boolean));
  // A missing email can be fixed with either address.
  if (issues.some((i) => i.check === 'Missing email')) { keys.add('officialEmail'); keys.add('personalEmail'); }
  return CORRECTABLE.filter((f) => keys.has(f.key));
}

function FixIssues({ payslip }) {
  const queryClient = useQueryClient();
  const fields = flaggedFields(payslip.issues);
  const initial = () => Object.fromEntries(fields.map((f) => [f.key, shown(f, payslip.data[f.key])]));
  const [values, setValues] = useState(initial);
  const version = `${payslip.id}:${payslip.edits?.length ?? 0}`;
  useEffect(() => setValues(initial()), [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const changes = Object.fromEntries(
    fields.filter((f) => values[f.key].trim() !== shown(f, payslip.data[f.key])).map((f) => [f.key, values[f.key].trim() || null]),
  );
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () => apiPatch(`/api/payslips/${payslip.id}`, { changes }),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.payslip(payslip.id), (old) => ({ ...old, ...updated }));
      queryClient.invalidateQueries({ queryKey: qk.payslips(payslip.runId) });
      queryClient.invalidateQueries({ queryKey: qk.run(payslip.runId) });
      queryClient.invalidateQueries({ queryKey: qk.runs });
      toast.success(`Saved changes for ${updated.fullName}`);
    },
  });

  if (!fields.length) return null;
  return (
    <form
      className="mt-4 space-y-3 rounded-xl border border-ember-500/25 bg-ember-500/[0.04] p-3.5"
      onSubmit={(e) => { e.preventDefault(); if (dirty) save.mutate(); }}
    >
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
        <PencilLine className="size-3.5 text-ember-600" /> Fix here
      </div>
      {fields.map((f) => (
        <Field key={f.key} label={f.label} htmlFor={`fix-${f.key}`}>
          <Input
            id={`fix-${f.key}`}
            type={f.type ?? 'text'}
            inputMode={f.inputMode}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            className={f.money ? 'num' : undefined}
            autoComplete="off"
          />
        </Field>
      ))}
      {save.error && <ErrorNote error={save.error} />}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11.5px] text-ink-3">The Excel file is not changed.</span>
        <Button type="submit" size="sm" variant="dark" disabled={!dirty} loading={save.isPending}>Save</Button>
      </div>
    </form>
  );
}

function Corrections({ edits }) {
  const display = (key, value) => {
    if (value === null || value === undefined || value === '') return 'blank';
    return key === 'netPay' ? money(value) : String(value);
  };
  return (
    <ul className="space-y-2.5">
      {[...edits].reverse().map((e, i) => (
        <li key={i} className="text-[12.5px]">
          <div className="font-medium text-ink">{CORRECTABLE_BY_KEY[e.field]?.label.replace(' (₹)', '') ?? e.field}</div>
          <div className="text-ink-3">
            <span className="line-through decoration-ink-4">{display(e.field, e.from)}</span> → <span className="text-ink">{display(e.field, e.to)}</span>
          </div>
          <div className="text-[11.5px] text-ink-4">{e.by?.name} · {dateTime(e.at)}</div>
        </li>
      ))}
    </ul>
  );
}

function Details({ payslip, runApproved }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const lastEmail = payslip.emails[0];
  const send = useMutation({
    mutationFn: () => apiPost(`/api/payroll-runs/${payslip.runId}/emails`, { payslipIds: [payslip.id], resend: Boolean(lastEmail) }),
    onSuccess: (r) => {
      if (r.queued) toast.success(`Payslip queued for ${payslip.fullName}`);
      else toast.message(r.skipped.noEmail ? 'No email address' : 'Payslip is blocked');
      queryClient.invalidateQueries({ queryKey: qk.payslip(payslip.id) });
      queryClient.invalidateQueries({ queryKey: qk.run(payslip.runId) });
    },
    onError: (e) => toast.error(e.message),
  });

  const issues = payslip.issues.filter((i) => i.severity !== 'info');
  const info = payslip.issues.filter((i) => i.severity === 'info' && i.check !== 'Corrected in app');
  const canFix = !runApproved && payslip.runStatus === 'draft' && can(PERM.PAYROLL_MANAGE);
  const edits = payslip.edits ?? [];
  const sourceEntries = Object.entries(payslip.sourceRow);

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-5 pt-5">
        <div>
          <div className="num text-[12px] text-ink-3">#{payslip.employeeCode} · row {payslip.rowNumber}</div>
          <h2 className="mt-1 text-[19px] font-semibold leading-tight tracking-tight">{payslip.fullName || 'Unnamed employee'}</h2>
          <div className="text-[13px] text-ink-3">{payslip.designation || 'No designation'}</div>
        </div>
        <div className="mt-5 rounded-xl bg-paper px-4 py-3.5">
          <div className="eyebrow">Net pay</div>
          <div className="num mt-1 text-[26px] font-semibold tracking-tight text-ember-600">{money(payslip.netPayPaise)}</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button asChild>
            <a href={`/api/payslips/${payslip.id}/pdf?download=1`} download>
              <Download /> PDF
            </a>
          </Button>
          {can(PERM.PAYSLIP_SEND) && (
            <Button
              variant="dark"
              disabled={!runApproved || process.env.NEXT_PUBLIC_FRONTEND_ONLY === 'true'}
              loading={send.isPending}
              onClick={() => send.mutate()}
              title={runApproved ? undefined : 'Approve the run first'}
            >
              <Mail /> {lastEmail ? 'Resend' : 'Email'}
            </Button>
          )}
        </div>
        <div className="mt-2 truncate text-[12px] text-ink-3" title={payslip.fileName}>{payslip.fileName}</div>
      </div>

      <Section title="Checks" aside={issues.length ? <span className="font-medium text-rust">{issues.length}</span> : <span className="text-moss">All clear</span>}>
        {issues.length === 0 ? (
          <p className="text-[13px] text-ink-3">No issues.</p>
        ) : (
          <ul className="space-y-2.5">
            {issues.map((issue, i) => (
              <li key={i} className="flex gap-2.5">
                <SeverityIcon severity={issue.severity} className="mt-0.5" />
                <div>
                  <div className="text-[13px] font-medium text-ink">{issue.check}</div>
                  <div className="text-[12.5px] leading-relaxed text-ink-3">{issue.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {canFix && <FixIssues payslip={payslip} />}
        {info.length > 0 && payslip.derivedFields.length > 0 && (
          <div className="mt-3 rounded-lg border border-line bg-paper px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
              <Sparkles className="size-3.5 text-ember-500" /> Derived values
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {payslip.derivedFields.map((f) => (
                <span key={f} className="rounded-md bg-surface px-1.5 py-0.5 text-[11.5px] text-ink-2 ring-1 ring-line">{FIELD_LABELS[f] ?? f}</span>
              ))}
            </div>
          </div>
        )}
      </Section>

      {edits.length > 0 && (
        <Section title="Edited in app" aside={<span className="flex items-center gap-1"><History className="size-3.5" />{edits.length}</span>}>
          <Corrections edits={edits} />
        </Section>
      )}

      <Section title="Email" aside={<EmailStatus status={lastEmail?.status} />}>
        {payslip.emails.length === 0 ? (
          <p className="text-[13px] text-ink-3">{payslip.recipientEmail ?? 'No email'}</p>
        ) : (
          <ul className="space-y-2">
            {payslip.emails.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 text-[12.5px]">
                <div className="min-w-0">
                  <div className="truncate text-ink">{e.to}</div>
                  <div className="text-ink-3">{dateTime(e.sentAt ?? e.createdAt)}{e.attempts > 1 ? ` · ${e.attempts} attempts` : ''}</div>
                  {e.error && <div className="mt-0.5 text-rust">{e.error}</div>}
                </div>
                <EmailStatus status={e.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Source row" defaultOpen={false} aside={<span className="num">{sourceEntries.length} cells</span>}>
        <p className="mb-2 text-[12px] text-ink-3">{payslip.sourceFileName} › {payslip.sourceSheet}</p>
        <dl className="divide-y divide-line rounded-lg border border-line text-[12px]">
          {sourceEntries.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 py-1.5">
              <dt className="truncate text-ink-3" title={k}>{k}</dt>
              <dd className={cn('num truncate text-right', v === null || v === '' ? 'text-ink-4' : 'text-ink')} title={String(v ?? '')}>
                {v === null || v === '' ? 'blank' : String(v)}
              </dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}

export function PayslipSheet({ payslipId, runApproved, ids = [], onNavigate, onClose }) {
  const detail = useQuery({
    queryKey: qk.payslip(payslipId),
    queryFn: () => apiGet(`/api/payslips/${payslipId}`),
    enabled: Boolean(payslipId),
  });
  const index = ids.indexOf(payslipId);
  const prev = index > 0 ? ids[index - 1] : null;
  const next = index >= 0 && index < ids.length - 1 ? ids[index + 1] : null;

  return (
    <Dialog open={Boolean(payslipId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        hideClose
        title={detail.data ? `Payslip for ${detail.data.fullName}` : 'Payslip'}
        onKeyDown={(e) => {
          if (e.target.tagName === 'INPUT') return;
          if (e.key === 'ArrowLeft' && prev) onNavigate(prev);
          if (e.key === 'ArrowRight' && next) onNavigate(next);
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Preview */}
          <div className="relative flex flex-col bg-sand md:min-h-0 md:flex-1">
            <div className="flex items-center justify-between border-b border-line bg-surface/70 px-4 py-2.5 backdrop-blur">
              <Button size="sm" variant="ghost" onClick={onClose} className="-ml-2 gap-1.5">
                <ArrowLeft /> Back
              </Button>
              <div className="flex items-center gap-1">
                <span className="num mr-2 text-[12px] text-ink-3">{index >= 0 ? `${index + 1} / ${ids.length}` : ''}</span>
                <Button size="icon-sm" variant="ghost" disabled={!prev} onClick={() => onNavigate(prev)} aria-label="Previous payslip"><ChevronLeft /></Button>
                <Button size="icon-sm" variant="ghost" disabled={!next} onClick={() => onNavigate(next)} aria-label="Next payslip"><ChevronRight /></Button>
              </div>
            </div>
            {process.env.NEXT_PUBLIC_FRONTEND_ONLY === 'true' && detail.data ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <img src="/demo/payslip-preview.png" alt={`Demo payslip for ${detail.data.fullName}`} className="mx-auto w-full max-w-[760px] shadow-card" />
              </div>
            ) : payslipId && (
              <iframe
                key={`${payslipId}-${detail.data?.edits?.length ?? 0}`}
                src={`/api/payslips/${payslipId}/pdf?v=${detail.data?.edits?.length ?? 0}#toolbar=0&navpanes=0&view=FitH`}
                title="Payslip PDF preview"
                className="hidden w-full flex-1 border-0 md:block"
              />
            )}
          </div>
          {/* Details */}
          <div className="w-full shrink-0 overflow-y-auto border-line scroll-thin md:w-[360px] md:border-l">
            {detail.isPending ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-4 h-20 w-full" />
              </div>
            ) : detail.error ? (
              <div className="p-5"><ErrorNote error={detail.error} /></div>
            ) : (
              <Details payslip={detail.data} runApproved={runApproved} />
            )}
          </div>
        </div>
      </SheetContent>
    </Dialog>
  );
}
