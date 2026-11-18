'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, ChevronRight, Download, FileSpreadsheet, Mail, MoreHorizontal, OctagonAlert, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { PERM, useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { dateTime, downloadBlob, money, periodLabel, plural, toCsv } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { PayslipSheet } from './payslip-sheet';
import { Button } from './shadcn/button';
import { Dialog, DialogContent, DialogFooter } from './shadcn/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './shadcn/dropdown-menu';
import { Input } from './shadcn/input';
import { Badge, Card, Checkbox, EmailStatus, EmptyState, ErrorNote, FadeSwap, RunStatusBadge, Segmented, SeverityBadge, Skeleton, Stat, Tabs } from './ui';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'unsent', label: 'Not emailed' },
];

/** Upload → Review → Approve → Send, with the current step highlighted. */
function RunSteps({ run }) {
  const allSent = run.stats.emailable > 0 && run.stats.emailsSent >= run.stats.emailable;
  const current = run.status !== 'approved' ? (run.stats.blocking > 0 ? 1 : 2) : allSent ? 4 : 3;
  const steps = [
    { label: 'Uploaded' },
    { label: run.stats.blocking > 0 ? 'Fix issues' : 'Reviewed' },
    { label: current > 2 ? 'Approved' : 'Approve' },
    { label: current > 3 ? 'Sent' : 'Send' },
  ];
  return (
    <ol className="mb-6 grid grid-cols-4 gap-2">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const bad = active && i === 1;
        return (
          <li key={s.label} className="min-w-0">
            <div className={cn('h-1 rounded-full', done ? 'bg-moss' : active ? (bad ? 'bg-rust' : 'bg-ember-500') : 'bg-sand-2')} />
            <div className={cn('mt-2 flex flex-col items-start gap-1 text-[11.5px] font-medium leading-tight sm:flex-row sm:items-center sm:gap-1.5 sm:truncate sm:text-[12.5px]', done ? 'text-ink-2' : active ? (bad ? 'text-rust' : 'text-ink') : 'text-ink-4')}>
              <span className={cn('num grid size-5 shrink-0 place-items-center rounded-full text-[11px]', done ? 'bg-moss text-white' : active ? (bad ? 'bg-rust text-white' : 'bg-ink text-white') : 'bg-sand text-ink-3')}>
                {done ? '✓' : i + 1}
              </span>
              {s.label}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function CheckCell({ p }) {
  if (p.blockingIssueCount) return <Badge tone="bad"><OctagonAlert className="size-3" />{plural(p.blockingIssueCount, 'blocker')}</Badge>;
  if (p.warningIssueCount) return <Badge tone="warn">{plural(p.warningIssueCount, 'warning')}</Badge>;
  return <Badge tone="ok">Ready</Badge>;
}

function PayslipTable({ payslips, selected, setSelected, onOpen }) {
  const allSelected = payslips.length > 0 && payslips.every((p) => selected.has(p.id));
  const someSelected = payslips.some((p) => selected.has(p.id));
  const toggleAll = () => {
    const next = new Set(selected);
    payslips.forEach((p) => (allSelected ? next.delete(p.id) : next.add(p.id)));
    setSelected(next);
  };
  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  if (!payslips.length) return <EmptyState icon={Search} title="No matches" />;

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line bg-white/40 text-left">
              <th className="w-10 py-2.5 pl-5"><Checkbox checked={allSelected} indeterminate={!allSelected && someSelected} onChange={toggleAll} aria-label="Select all" /></th>
              <th className="eyebrow py-2.5 pr-4 font-medium">Employee</th>
              <th className="eyebrow py-2.5 pr-4 text-right font-medium">Days</th>
              <th className="eyebrow py-2.5 pr-4 text-right font-medium">Monthly CTC</th>
              <th className="eyebrow py-2.5 pr-4 text-right font-medium">Net pay</th>
              <th className="eyebrow py-2.5 pr-4 font-medium">Email</th>
              <th className="eyebrow py-2.5 pr-4 font-medium">Checks</th>
              <th className="eyebrow py-2.5 pr-4 font-medium">Delivery</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {payslips.map((p) => (
              <tr
                key={p.id}
                onClick={() => onOpen(p.id)}
                className={cn('group cursor-pointer transition-colors hover:bg-white/60', selected.has(p.id) && 'bg-ember-50/50 hover:bg-ember-50')}
              >
                <td className="py-3 pl-5" onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.fullName}`} />
                </td>
                <td className="max-w-[260px] py-3 pr-4">
                  <div className="truncate font-medium text-ink">{p.fullName || <span className="text-rust">Missing name</span>}</div>
                  <div className="truncate text-[12px] text-ink-3"><span className="num">{p.employeeCode}</span>{p.designation ? ` · ${p.designation}` : ''}</div>
                </td>
                <td className="num py-3 pr-4 text-right text-ink-2">{p.workingDays ?? '—'}</td>
                <td className="num py-3 pr-4 text-right text-ink-2">{money(p.ctcPaise, { whole: true })}</td>
                <td className="num py-3 pr-4 text-right font-semibold text-ink">{money(p.netPayPaise)}</td>
                <td className="max-w-[220px] py-3 pr-4">
                  {p.email ? (
                    <div className="truncate text-ink-2" title={p.emailFromDirectory ? 'From the employee directory' : undefined}>
                      {p.email}
                      {p.emailFromDirectory && <span className="ml-1 text-[11px] text-ink-4">· directory</span>}
                    </div>
                  ) : (
                    <span className="text-[12.5px] text-amber">No email</span>
                  )}
                </td>
                <td className="py-3 pr-4"><CheckCell p={p} /></td>
                <td className="py-3 pr-4"><EmailStatus status={p.emailStatus} error={p.emailError} /></td>
                <td className="pr-4"><ChevronRight className="size-4 text-ink-4 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-2" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile list */}
      <ul className="divide-y divide-line md:hidden">
        {payslips.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-3.5">
            <Checkbox checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.fullName}`} />
            <button onClick={() => onOpen(p.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.fullName}</div>
                <div className="num truncate text-[12px] text-ink-3">{p.employeeCode} · {money(p.netPayPaise)}</div>
              </div>
              <CheckCell p={p} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function IssuesList({ payslips, onOpen, period, canFix = false }) {
  const [showInfo, setShowInfo] = useState(false);
  const rows = payslips.flatMap((p) => p.issues.map((issue) => ({ ...issue, p })));
  const visible = rows.filter((r) => showInfo || r.severity !== 'info');
  const order = { blocking: 0, warning: 1, info: 2 };
  visible.sort((a, b) => order[a.severity] - order[b.severity] || a.p.rowNumber - b.p.rowNumber);

  const exportCsv = () => {
    const csv = toCsv([
      ['Severity', 'Employee ID', 'Full Name', 'Check', 'Detail'],
      ...rows.map((r) => [r.severity, r.p.employeeCode, r.p.fullName, r.check, r.detail]),
    ]);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `Keystone_Payroll_Audit_${period}.csv`);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <Checkbox checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} /> Show info
          </label>
          <Button size="sm" onClick={exportCsv}><Download /> CSV</Button>
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState icon={BadgeCheck} title="No issues" />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {visible.map((r, i) => (
            <li key={i}>
              <button onClick={() => onOpen(r.p.id)} className="grid w-full grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-1 px-5 py-3 text-left transition-colors hover:bg-white/60 md:grid-cols-[110px_220px_minmax(0,1fr)]">
                <span><SeverityBadge severity={r.severity} /></span>
                <span className="min-w-0 truncate text-[13px] font-medium">{r.p.fullName || r.p.employeeCode} <span className="num font-normal text-ink-3">#{r.p.employeeCode}</span></span>
                <span className="col-span-2 min-w-0 text-[13px] md:col-span-1">
                  <span className="text-ink">{r.check}</span> <span className="text-ink-3">· {r.detail}</span>
                </span>
                {canFix && r.severity !== 'info' && (
                  <span className="hidden items-center text-[12.5px] font-medium text-ember-600 group-hover:underline md:flex">Fix</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ApproveDialog({ run, open, onOpenChange }) {
  const queryClient = useQueryClient();
  const approve = useMutation({
    mutationFn: () => apiPost(`/api/payroll-runs/${run.id}/approve`),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.run(run.id), updated);
      queryClient.invalidateQueries({ queryKey: qk.runs });
      toast.success(`${periodLabel(run.period)} approved`);
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { approve.reset(); onOpenChange(o); }}>
      <DialogContent title={`Approve ${periodLabel(run.period)}?`} description="Payslips will be locked.">
        <div className="mx-6 mb-5 mt-3 divide-y divide-line rounded-xl border border-line">
          {[
            ['Employees', run.employeeCount],
            ['Total net pay', money(run.netPayTotalPaise)],
            ['Warnings', run.stats.warnings],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between px-4 py-2.5 text-[13.5px]">
              <span className="text-ink-3">{k}</span>
              <span className="num font-medium">{v}</span>
            </div>
          ))}
        </div>
        {approve.error && <div className="px-6 pb-4"><ErrorNote error={approve.error} /></div>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="dark" loading={approve.isPending} onClick={() => approve.mutate()}><BadgeCheck /> Approve run</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendDialog({ run, payslips, selectedIds, open, onOpenChange, onSent }) {
  const queryClient = useQueryClient();
  const [resend, setResend] = useState(false);
  const scope = selectedIds.length ? payslips.filter((p) => selectedIds.includes(p.id)) : payslips;
  const eligible = scope.filter((p) => !p.blockingIssueCount && p.email);
  const already = eligible.filter((p) => ['sent', 'pending', 'sending'].includes(p.emailStatus));
  const count = resend ? eligible.length : eligible.length - already.length;
  const noEmail = scope.filter((p) => !p.email).length;

  const send = useMutation({
    mutationFn: () => apiPost(`/api/payroll-runs/${run.id}/emails`, { payslipIds: selectedIds.length ? selectedIds : null, resend }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: qk.run(run.id) });
      queryClient.invalidateQueries({ queryKey: qk.payslips(run.id) });
      toast.success(`${plural(r.queued, 'payslip')} queued`);
      onSent();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { send.reset(); setResend(false); onOpenChange(o); }}>
      <DialogContent title={`Email ${plural(count, 'payslip')}?`}>
        <ul className="mx-6 mb-4 mt-3 space-y-1.5 text-[13px] text-ink-2">
          <li className="flex justify-between"><span>{selectedIds.length ? 'Selected' : 'In this run'}</span><span className="num">{scope.length}</span></li>
          <li className="flex justify-between"><span>Already sent</span><span className="num">{already.length}</span></li>
          <li className="flex justify-between"><span>No email</span><span className={cn('num', noEmail && 'text-amber')}>{noEmail}</span></li>
        </ul>
        {already.length > 0 && (
          <label className="mx-6 mb-4 flex items-center gap-2 rounded-lg bg-paper px-3 py-2.5 text-[13px]">
            <Checkbox checked={resend} onChange={(e) => setResend(e.target.checked)} />
            Resend to {already.length} already sent
          </label>
        )}
        {send.error && <div className="px-6 pb-4"><ErrorNote error={send.error} /></div>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={count === 0} loading={send.isPending} onClick={() => send.mutate()}>
            <Mail /> Send {count}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RunDetail({ runId, navigate }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('payslips');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [openId, setOpenId] = useState(null);
  const [dialog, setDialog] = useState(null);

  const run = useQuery({
    queryKey: qk.run(runId),
    queryFn: () => apiGet(`/api/payroll-runs/${runId}`),
    refetchInterval: (q) => (q.state.data?.stats?.emailsQueued > 0 ? 3000 : false),
  });
  const delivering = run.data?.stats?.emailsQueued > 0;
  const payslips = useQuery({
    queryKey: qk.payslips(runId),
    queryFn: async () => (await apiGet(`/api/payroll-runs/${runId}/payslips`)).items,
    refetchInterval: delivering ? 3000 : false,
  });
  const settings = useQuery({ queryKey: qk.settings, queryFn: () => apiGet('/api/settings'), staleTime: 300_000 });

  // When delivery finishes, refresh once more so the last statuses land.
  useEffect(() => {
    if (!delivering) queryClient.invalidateQueries({ queryKey: qk.payslips(runId) });
  }, [delivering, queryClient, runId]);

  const remove = useMutation({
    mutationFn: () => apiDelete(`/api/payroll-runs/${runId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.runs });
      toast.success('Draft deleted');
      navigate('/runs');
    },
    onError: (e) => toast.error(e.message),
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (payslips.data ?? []).filter((p) => {
      if (filter === 'attention' && !p.blockingIssueCount && !p.warningIssueCount) return false;
      if (filter === 'unsent' && p.emailStatus === 'sent') return false;
      if (!q) return true;
      return [p.employeeCode, p.fullName, p.designation, p.email].some((v) => v?.toLowerCase().includes(q));
    });
  }, [payslips.data, filter, query]);

  if (run.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (run.error) {
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title={run.error.status === 404 ? 'This run does not exist' : 'Could not load this run'}
        description={run.error.status === 404 ? undefined : run.error.message}
        action={<Button onClick={() => navigate('/runs')}><ArrowLeft /> All runs</Button>}
      />
    );
  }

  const r = run.data;
  const approved = r.status === 'approved';
  const selectedIds = [...selected];
  const issueCount = (payslips.data ?? []).reduce((n, p) => n + p.blockingIssueCount + p.warningIssueCount, 0);
  const zipHref = `/api/payroll-runs/${runId}/payslips.zip${selectedIds.length ? `?ids=${selectedIds.join(',')}` : ''}`;
  const emailReady = settings.data ? Boolean(settings.data.emailProvider) : true;

  return (
    <>
      <a href="#/runs" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink">
        <ArrowLeft className="size-4" /> Payroll runs
      </a>

      <header className="flex flex-col gap-5 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <RunStatusBadge status={r.status} />
            {delivering && <Badge tone="brand"><Mail className="size-3" /> Sending {r.stats.emailsQueued}</Badge>}
          </div>
          <h1 className="mt-3 font-display text-[40px] leading-none tracking-[-0.01em] sm:text-[48px]">{periodLabel(r.period)}</h1>
          <div className="mt-3 flex flex-col gap-1 text-[13px] text-ink-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <FileSpreadsheet className="size-3.5 shrink-0" />
              <span className="truncate"><span className="text-ink-2">{r.sourceFileName}</span> › {r.sourceSheet}</span>
            </span>
            <span className="hidden text-ink-4 sm:inline">·</span>
            <span>{approved ? `Approved by ${r.approvedBy?.name}, ${dateTime(r.approvedAt)}` : `Created by ${r.createdBy?.name}, ${dateTime(r.createdAt)}`}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            <a href={zipHref} download><Download /> {selectedIds.length ? `ZIP (${selectedIds.length})` : 'All PDFs'}</a>
          </Button>
          {!approved && can(PERM.PAYROLL_APPROVE) && (
            <Button variant="dark" disabled={r.stats.blocking > 0} onClick={() => setDialog('approve')} title={r.stats.blocking ? 'Resolve blocking issues first' : undefined}>
              <BadgeCheck /> Approve
            </Button>
          )}
          {approved && can(PERM.PAYSLIP_SEND) && (
            <Button variant="primary" disabled={!emailReady} onClick={() => setDialog('send')} title={emailReady ? undefined : 'Email is not configured'}>
              <Mail /> {selectedIds.length ? `Email ${selectedIds.length}` : 'Email payslips'}
            </Button>
          )}
          {!approved && can(PERM.PAYROLL_MANAGE) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" aria-label="More actions"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem destructive onSelect={() => setDialog('delete')}><Trash2 /> Delete draft</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <RunSteps run={r} />

      {!approved && r.stats.blocking > 0 && (
        <div className="mb-5 flex gap-3 rounded-xl border border-rust-line bg-rust-bg px-4 py-3.5 text-[13.5px] text-rust">
          <OctagonAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <span className="font-semibold">{plural(r.stats.blocking, 'blocked payslip')}</span>
            <button onClick={() => { setTab('issues'); }} className="ml-2 font-medium underline underline-offset-2">{can(PERM.PAYROLL_MANAGE) ? 'Review and fix' : 'View'}</button>
          </div>
        </div>
      )}
      {approved && !emailReady && (
        <div className="mb-5 rounded-xl border border-amber-line bg-amber-bg px-4 py-3 text-[13px] text-amber">
          Email not configured.
        </div>
      )}

      <Card className="mb-6 grid grid-cols-2 divide-line max-lg:[&>*:nth-child(-n+2)]:border-b lg:grid-cols-4 lg:divide-x [&>*:nth-child(odd)]:border-r lg:[&>*]:border-r-0">
        <Stat label="Employees" value={r.employeeCount} />
        <Stat label="Net pay total" value={money(r.netPayTotalPaise, { whole: true })} tone="brand" />
        <Stat label="Needs attention" value={r.stats.blocking + r.stats.warnings} tone={r.stats.blocking ? 'bad' : undefined} hint={`${r.stats.blocking} blocking · ${r.stats.warnings} warnings`} />
        <Stat
          label="Emailed"
          value={<span>{r.stats.emailsSent}<span className="text-ink-4">/{r.stats.emailable}</span></span>}
          hint={r.stats.emailsFailed ? <span className="text-rust">{r.stats.emailsFailed} failed</span> : undefined}
        />
      </Card>

      <Card className="overflow-hidden">
        <Tabs
          className="px-3"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'payslips', label: 'Payslips', count: payslips.data?.length },
            { value: 'issues', label: 'Checks', count: issueCount },
          ]}
        />
        {payslips.isPending ? (
          <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : payslips.error ? (
          <div className="p-5"><ErrorNote error={payslips.error} /></div>
        ) : (
          <FadeSwap id={tab}>
          {tab === 'payslips' ? (
          <>
            <div className="flex flex-col gap-3 border-b border-line px-5 py-3 sm:flex-row sm:items-center">
              <div className="relative sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-4" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, ID, email…" className="pl-9" />
              </div>
              <Segmented value={filter} onChange={setFilter} items={FILTERS} />
              {selected.size > 0 && (
                <div className="flex items-center gap-2 text-[12.5px] text-ink-2 sm:ml-auto">
                  <span className="num font-medium">{selected.size} selected</span>
                  <button onClick={() => setSelected(new Set())} className="grid size-6 place-items-center rounded-md text-ink-3 hover:bg-sand hover:text-ink" aria-label="Clear selection">
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
            </div>
            <PayslipTable payslips={visible} selected={selected} setSelected={setSelected} onOpen={setOpenId} />
          </>
        ) : (
          <IssuesList payslips={payslips.data} onOpen={setOpenId} period={r.period} canFix={!approved && can(PERM.PAYROLL_MANAGE)} />
          )}
          </FadeSwap>
        )}
      </Card>

      <PayslipSheet
        payslipId={openId}
        runApproved={approved}
        ids={visible.map((p) => p.id)}
        onNavigate={setOpenId}
        onClose={() => setOpenId(null)}
      />
      <ApproveDialog run={r} open={dialog === 'approve'} onOpenChange={(o) => setDialog(o ? 'approve' : null)} />
      <SendDialog
        run={r}
        payslips={payslips.data ?? []}
        selectedIds={selectedIds}
        open={dialog === 'send'}
        onOpenChange={(o) => setDialog(o ? 'send' : null)}
        onSent={() => setSelected(new Set())}
      />
      <Dialog open={dialog === 'delete'} onOpenChange={(o) => setDialog(o ? 'delete' : null)}>
        <DialogContent title="Delete this draft?">
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}><Trash2 /> Delete draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
