'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FileSpreadsheet, Plus, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { apiGet } from '@/lib/api';
import { PERM, useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { moneyCompact, periodLabel, plural, relativeTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { NewRunDialog } from './new-run-dialog';
import { Button } from './shadcn/button';
import { Card, EmptyState, ErrorNote, PageHeader, RunStatusBadge, Skeleton } from './ui';

function EmailProgress({ stats }) {
  const total = stats.emailable || 0;
  const sent = Math.min(stats.emailsSent, total);
  const pct = total ? Math.round((sent / total) * 100) : 0;
  return (
    <div className="w-full">
      <div className="flex justify-between text-[12px] text-ink-3">
        <span>Emailed</span>
        <span className="num">{sent}/{total}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sand">
        <div className={cn('h-full rounded-full transition-all', pct === 100 ? 'bg-moss' : 'bg-ember-500')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RunRow({ run }) {
  const [year] = run.period.split('-');
  const month = periodLabel(run.period).split(' ')[0];
  const issues = run.stats.blocking;
  return (
    <a
      href={`#/runs/${run.id}`}
      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2.5 px-5 py-4 transition-colors hover:bg-white/60 md:gap-x-5 md:grid-cols-[110px_minmax(0,1fr)_120px_150px_20px] xl:grid-cols-[150px_minmax(0,1fr)_130px_160px_160px_24px]"
    >
      <div className="flex items-baseline gap-2 md:block">
        <div className="font-display text-[24px] leading-none text-ink">{month}</div>
        <div className="num text-[13px] text-ink-3 md:mt-1 md:text-[12px]">{year}</div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 max-md:order-last max-md:col-span-2">
        <div className="flex items-center gap-2">
          <RunStatusBadge status={run.status} />
          {issues > 0 && <span className="text-[12px] font-medium text-rust">{plural(issues, 'blocking issue')}</span>}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
          <FileSpreadsheet className="size-3.5 shrink-0" />
          <span className="truncate">{run.sourceFileName} · {run.sourceSheet}</span>
        </div>
      </div>
      <div className="text-right md:text-left">
        <div className="num text-[15px] font-semibold text-ink">{moneyCompact(run.netPayTotalPaise)}</div>
        <div className="text-[12px] text-ink-3">{plural(run.employeeCount, 'employee')}</div>
      </div>
      <div className="hidden md:block">
        {run.status === 'approved' ? <EmailProgress stats={run.stats} /> : <span className="text-[12px] text-ink-4">—</span>}
      </div>
      <div className="hidden text-[12px] text-ink-3 xl:block">
        {run.status === 'approved' ? `Approved by ${run.approvedBy?.name}` : `Created by ${run.createdBy?.name}`}
        <div className="text-ink-4">{relativeTime(run.approvedAt ?? run.createdAt)}</div>
      </div>
      <ArrowUpRight className="hidden size-4 text-ink-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink md:block" />
    </a>
  );
}

export function RunsModule({ navigate }) {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const runs = useQuery({ queryKey: qk.runs, queryFn: async () => (await apiGet('/api/payroll-runs')).items });
  const canCreate = can(PERM.PAYROLL_MANAGE);

  return (
    <>
      <PageHeader
        title="Payroll runs"
        actions={canCreate && (
          <Button variant="primary" onClick={() => setCreating(true)} aria-label="New run" title="New run" className="max-sm:w-9 max-sm:px-0">
            <Plus /> <span className="max-sm:hidden">New run</span>
          </Button>
        )}
      />

      <Card className="overflow-hidden">
        <div className="hidden gap-x-5 border-b border-line bg-white/40 px-5 py-2.5 md:grid md:grid-cols-[110px_minmax(0,1fr)_120px_150px_20px] xl:grid-cols-[150px_minmax(0,1fr)_130px_160px_160px_24px]">
          {['Month', 'Status & source', 'Net pay', 'Delivery', 'Activity', ''].map((h) => (
            <div key={h} className={cn('eyebrow whitespace-nowrap', h === 'Activity' && 'hidden xl:block')}>{h}</div>
          ))}
        </div>
        {runs.isPending ? (
          <div className="divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-6 px-5 py-5">
                <Skeleton className="h-7 w-28" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : runs.error ? (
          <div className="p-5">
            <ErrorNote error={runs.error} />
            <Button className="mt-3" size="sm" onClick={() => runs.refetch()}><RotateCw /> Retry</Button>
          </div>
        ) : runs.data.length === 0 ? (
          <EmptyState
            icon={FileSpreadsheet}
            title="No payroll runs yet"
            description="Upload the month's Excel register to create payslips."
            action={canCreate && <Button variant="primary" onClick={() => setCreating(true)}><Plus /> Upload register</Button>}
          />
        ) : (
          <div className="divide-y divide-line">
            {runs.data.map((run) => <RunRow key={run.id} run={run} />)}
          </div>
        )}
      </Card>

      <NewRunDialog open={creating} onOpenChange={setCreating} onCreated={(id) => { setCreating(false); navigate(`/runs/${id}`); }} />
    </>
  );
}
