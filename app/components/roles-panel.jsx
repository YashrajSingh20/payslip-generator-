'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, MoreHorizontal, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { Button } from './shadcn/button';
import { Dialog, DialogContent, DialogFooter } from './shadcn/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './shadcn/dropdown-menu';
import { Input } from './shadcn/input';
import { Badge, Card, ErrorNote, Field, Skeleton } from './ui';

// Plain-language labels, grouped the way people think about the app.
const GROUPS = [
  { title: 'Payroll runs', items: [
    ['payroll.read', 'View runs and payslips'],
    ['payroll.manage', 'Upload, fix and delete drafts'],
    ['payroll.approve', 'Approve runs'],
    ['payslip.send', 'Email payslips'],
  ] },
  { title: 'Employees', items: [
    ['employees.read', 'View employees'],
    ['employees.manage', 'Import, edit and sync employees'],
  ] },
  { title: 'Admin', items: [
    ['settings.manage', 'Change payslip and email settings'],
    ['users.manage', 'Add people and assign roles'],
    ['roles.manage', 'Create roles and set permissions'],
  ] },
];
const LABEL = Object.fromEntries(GROUPS.flatMap((g) => g.items));

function RoleDialog({ open, role, onClose }) {
  const queryClient = useQueryClient();
  const editing = Boolean(role);
  const locked = Boolean(role?.locked);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState([]);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(role?.name ?? '');
      setDescription(role?.description ?? '');
      setPermissions(role?.permissions ?? ['payroll.read']);
    }
  }

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, ...(locked ? {} : { permissions }) };
      return editing ? apiPatch(`/api/roles/${role.id}`, body) : apiPost('/api/roles', body);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: qk.roles });
      queryClient.invalidateQueries({ queryKey: qk.users });
      queryClient.invalidateQueries({ queryKey: qk.me });
      toast.success(editing ? `${saved.name} updated` : `${saved.name} created`);
      onClose();
    },
  });
  const toggle = (key) => setPermissions((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { save.reset(); onClose(); } }}>
      <DialogContent title={editing ? `Edit ${role.name}` : 'New role'} description={locked ? 'Super admin always has every permission.' : undefined}>
        <form id="role-form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4 px-6 pb-6 pt-4">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus={!editing} maxLength={100} /></Field>
          <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="Optional" /></Field>
          <div className="space-y-3">
            {GROUPS.map((group) => (
              <fieldset key={group.title} disabled={locked}>
                <legend className="eyebrow mb-1.5">{group.title}</legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {group.items.map(([key, label]) => {
                    const checked = locked || permissions.includes(key);
                    return (
                      <label key={key} className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-colors', checked ? 'border-ink/70 bg-white/70' : 'border-line hover:border-line-strong', locked && 'cursor-default opacity-70')}>
                        <input type="checkbox" className="size-4 accent-ember-500" checked={checked} onChange={() => toggle(key)} />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          <ErrorNote error={save.error} />
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="dark" type="submit" form="role-form" disabled={!name.trim()} loading={save.isPending}>{editing ? 'Save' : 'Create role'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RolesPanel({ canManage }) {
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: qk.roles, queryFn: async () => (await apiGet('/api/roles')).items });
  const [dialog, setDialog] = useState(null);
  const remove = useMutation({
    mutationFn: (role) => apiDelete(`/api/roles/${role.id}`).then(() => role),
    onSuccess: (role) => {
      queryClient.invalidateQueries({ queryKey: qk.roles });
      toast.success(`${role.name} deleted`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      {canManage && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setDialog({ role: null })}><Plus /> New role</Button>
        </div>
      )}
      <Card className="overflow-hidden">
        {roles.isPending ? (
          <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : roles.error ? (
          <div className="p-5"><ErrorNote error={roles.error} /></div>
        ) : (
          <ul className="divide-y divide-line">
            {roles.data.map((role) => (
              <li key={role.id} className="flex items-start gap-4 px-5 py-3.5">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-sand text-ink-2">
                  {role.locked ? <Lock className="size-4" /> : <ShieldCheck className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                    {role.name}
                    {role.isSystem && <Badge>Built-in</Badge>}
                    <span className="text-[12px] font-normal text-ink-3">{plural(role.holders, 'person', 'people')}</span>
                  </div>
                  {role.description && <div className="truncate text-[12.5px] text-ink-3">{role.description}</div>}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {role.locked ? (
                      <span className="text-[12px] text-ink-3">Everything</span>
                    ) : role.permissions.length ? (
                      role.permissions.map((p) => (
                        <span key={p} className="rounded-md bg-white/60 px-1.5 py-0.5 text-[11.5px] text-ink-2 ring-1 ring-line">{LABEL[p] ?? p}</span>
                      ))
                    ) : (
                      <span className="text-[12px] text-ink-4">No permissions</span>
                    )}
                  </div>
                </div>
                {canManage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${role.name}`}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => setDialog({ role })}>Edit</DropdownMenuItem>
                      {!role.isSystem && (
                        <DropdownMenuItem destructive disabled={role.holders > 0} onSelect={() => remove.mutate(role)}>
                          {role.holders > 0 ? 'Delete (in use)' : 'Delete'}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <RoleDialog open={Boolean(dialog)} role={dialog?.role} onClose={() => setDialog(null)} />
    </>
  );
}
