'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Pencil, RefreshCw, Search, Upload, Users } from 'lucide-react';
import { useDeferredValue, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { PERM, useAuth } from '@/lib/auth';
import { calendarDate, periodLabel, plural, relativeTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { Button } from './shadcn/button';
import { Dialog, DialogContent, DialogFooter } from './shadcn/dialog';
import { Input } from './shadcn/input';
import { Badge, Card, EmptyState, ErrorNote, Field, PageHeader, Skeleton } from './ui';
import { SheetPicker, WorkbookDropzone } from './workbook-dropzone';

function EditEmployeeDialog({ employee, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (employee) setForm({ fullName: employee.fullName, designation: employee.designation ?? '', officialEmail: employee.officialEmail ?? '', personalEmail: employee.personalEmail ?? '' });
  }, [employee]);

  const save = useMutation({
    mutationFn: () => apiPatch(`/api/employees/${encodeURIComponent(employee.employeeCode)}`, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: qk.runs });
      toast.success('Employee updated');
      onClose();
    },
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const portal = employee?.source === 'team_portal';

  return (
    <Dialog open={Boolean(employee)} onOpenChange={(o) => { if (!o) { save.reset(); onClose(); } }}>
      <DialogContent title={employee?.fullName ?? ''} description={`#${employee?.employeeCode}`}>
        {form && (
          <form id="edit-employee" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-4 px-6 pb-6 pt-4 sm:grid-cols-2">
            {portal && (
              <p className="flex items-center gap-1.5 text-[12.5px] text-ink-3 sm:col-span-2">
                <Link2 className="size-3.5 text-ember-600" /> Name and official email come from the Team Portal.
              </p>
            )}
            <Field label="Full name" className="sm:col-span-2"><Input value={form.fullName} onChange={set('fullName')} required disabled={portal} /></Field>
            <Field label="Designation" className="sm:col-span-2"><Input value={form.designation} onChange={set('designation')} /></Field>
            <Field label="Official email"><Input type="email" value={form.officialEmail} onChange={set('officialEmail')} disabled={portal} /></Field>
            <Field label="Personal email"><Input type="email" value={form.personalEmail} onChange={set('personalEmail')} /></Field>
            <ErrorNote error={save.error} className="sm:col-span-2" />
          </form>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="dark" type="submit" form="edit-employee" loading={save.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportMasterDialog({ open, onOpenChange }) {
  const queryClient = useQueryClient();
  const [upload, setUpload] = useState(null);
  const [sheetName, setSheetName] = useState('');
  const run = useMutation({
    mutationFn: () => apiPost('/api/employees/import', { importId: upload.id, sheetName }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success(`${r.total} employees imported`, { description: `${r.inserted} new · ${r.updated} updated` });
      close(false);
    },
  });
  function close(o) {
    if (!o) {
      setUpload(null);
      setSheetName('');
      run.reset();
    }
    onOpenChange(o);
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title="Import employee master">
        <div className="px-6 pb-6 pt-4">
          {!upload ? (
            <WorkbookDropzone
              onUploaded={(u) => {
                setUpload(u);
                setSheetName((u.sheets.find((s) => s.kind === 'master') ?? u.sheets[0]).name);
              }}
            />
          ) : (
            <Field label="Sheet">
              <SheetPicker sheets={upload.sheets} value={sheetName} onChange={setSheetName} preferKind="master" />
            </Field>
          )}
          <ErrorNote error={run.error} className="mt-3" />
        </div>
        {upload && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUpload(null)}>Back</Button>
            <Button variant="dark" loading={run.isPending} onClick={() => run.mutate()}>Import</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SourceBadges({ employee }) {
  return (
    <>
      {employee.source === 'team_portal' && (
        <span title={employee.syncedAt ? `From Team Portal, synced ${relativeTime(employee.syncedAt)}` : 'From Team Portal'}>
          <Link2 className="size-3.5 shrink-0 text-ember-600" aria-label="From Team Portal" />
        </span>
      )}
      {employee.isActive === false && <Badge tone="neutral">Inactive</Badge>}
    </>
  );
}

/**
 * "Sync from Team Portal", beside Import master. Hidden when the integration is
 * off. The last sync (or why it failed) shows as the button's tooltip.
 */
function TeamPortalSyncButton() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: qk.teamPortalSync, queryFn: () => apiGet('/api/team-portal-sync'), refetchInterval: 60_000 });
  const sync = useMutation({
    mutationFn: () => apiPost('/api/team-portal-sync', {}, { timeoutMs: 60_000 }),
    onSuccess: (r) => {
      const changes = r.created + r.updated + r.deactivated;
      toast.success(changes ? `Synced: ${r.created} new, ${r.updated} updated${r.deactivated ? `, ${r.deactivated} inactive` : ''}` : 'Already up to date');
      if (r.skipped) toast.message(`${plural(r.skipped, 'person', 'people')} skipped`, { description: r.skippedRows.map((x) => `${x.name ?? x.employeeCode ?? '?'}: ${x.reason}`).join(', ') });
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.teamPortalSync });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });

  const s = status.data;
  if (!s?.configured) return null;
  const failed = s.lastRun?.status === 'failed';
  const tip = failed
    ? `Last sync failed: ${s.lastRun.error}`
    : s.lastSuccessAt ? `Synced ${relativeTime(s.lastSuccessAt)} · ${plural(s.linkedEmployees, 'linked employee')}` : 'Not synced yet';
  return (
    <Button onClick={() => sync.mutate()} loading={sync.isPending} aria-label="Sync from Team Portal" title={tip} className="relative max-sm:w-9 max-sm:px-0">
      <RefreshCw /> <span className="max-sm:hidden">Sync from Team Portal</span>
      {failed && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-rust ring-2 ring-white" aria-hidden />}
    </Button>
  );
}

export function EmployeesModule() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const canManage = can(PERM.EMPLOYEES_MANAGE);

  const list = useInfiniteQuery({
    queryKey: qk.employees(query),
    queryFn: ({ pageParam }) => apiGet(`/api/employees?limit=100&q=${encodeURIComponent(query)}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Employees"
        actions={canManage && (
          <>
            <TeamPortalSyncButton />
            <Button onClick={() => setImporting(true)} aria-label="Import master" title="Import master" className="max-sm:w-9 max-sm:px-0"><Upload /> <span className="max-sm:hidden">Import master</span></Button>
          </>
        )}
      />
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-4" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID, email, designation…" className="pl-9" />
          </div>
          <span className="num hidden shrink-0 text-[12.5px] text-ink-3 sm:block">{total}</span>
        </div>
        {list.isPending ? (
          <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : list.error ? (
          <div className="p-5"><ErrorNote error={list.error} /></div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={query ? 'No matches' : 'No employees yet'}
          />
        ) : (
          <div>
            {/* Phones: one compact row per person */}
            <ul className="divide-y divide-line md:hidden">
              {items.map((e) => (
                <li key={e.employeeCode} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[14px] font-medium">{e.fullName || '—'}</span>
                      <span className="num shrink-0 text-[12px] text-ink-3">#{e.employeeCode}</span>
                      <SourceBadges employee={e} />
                    </div>
                    <div className="truncate text-[12.5px] text-ink-3">{e.designation || 'No designation'}</div>
                    <div className="mt-1 truncate text-[12.5px] text-ink-2">
                      {e.officialEmail || e.personalEmail || <span className="text-ink-4">No email</span>}
                    </div>
                    {(e.joiningDate || e.lastPeriod) && (
                      <div className="mt-0.5 text-[12px] text-ink-4">
                        {[e.joiningDate && `Joined ${calendarDate(e.joiningDate)}`, e.lastPeriod && `Last payslip ${periodLabel(e.lastPeriod)}`].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  {canManage && (
                    <Button size="icon-sm" variant="ghost" onClick={() => setEditing(e)} aria-label={`Edit ${e.fullName}`} className="-mr-2 shrink-0">
                      <Pencil />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-white/40 text-left">
                  {['ID', 'Employee', 'Official email', 'Personal email', 'Joined', 'Last payslip', ''].map((h) => (
                    <th key={h} className="eyebrow px-5 py-2.5 font-medium first:pl-5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((e) => (
                  <tr key={e.employeeCode} className="group hover:bg-white/60">
                    <td className="num px-5 py-3 text-ink-2">{e.employeeCode}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 font-medium">{e.fullName || '—'} <SourceBadges employee={e} /></div>
                      <div className="text-[12px] text-ink-3">{e.designation || '—'}</div>
                    </td>
                    <td className="px-5 py-3 text-ink-2">{e.officialEmail || <span className="text-ink-4">—</span>}</td>
                    <td className="px-5 py-3 text-ink-2">{e.personalEmail || <span className="text-ink-4">—</span>}</td>
                    <td className="px-5 py-3 text-ink-3">{calendarDate(e.joiningDate)}</td>
                    <td className="px-5 py-3 text-ink-3">{e.lastPeriod ? periodLabel(e.lastPeriod) : '—'}</td>
                    <td className="px-5 py-3 text-right">
                      {canManage && (
                        <Button size="icon-sm" variant="ghost" onClick={() => setEditing(e)} aria-label={`Edit ${e.fullName}`} className="opacity-60 group-hover:opacity-100">
                          <Pencil />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {list.hasNextPage && (
              <div className="border-t border-line p-3 text-center">
                <Button size="sm" variant="ghost" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Load more</Button>
              </div>
            )}
          </div>
        )}
      </Card>
      <EditEmployeeDialog employee={editing} onClose={() => setEditing(null)} />
      <ImportMasterDialog open={importing} onOpenChange={setImporting} />
    </>
  );
}
