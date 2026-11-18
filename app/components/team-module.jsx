'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { PERM, useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { Button } from './shadcn/button';
import { Dialog, DialogContent, DialogFooter } from './shadcn/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './shadcn/dropdown-menu';
import { Input } from './shadcn/input';
import { RolesPanel } from './roles-panel';
import { Avatar, Badge, Card, ErrorNote, Field, PageHeader, Skeleton, Tabs } from './ui';

function RolePicker({ roles, value, onChange }) {
  return (
    <div className="grid gap-2">
      {roles.map((role) => {
        const checked = value.includes(role.key);
        return (
          <label key={role.key} className={cn('flex cursor-pointer gap-3 rounded-xl border px-3.5 py-3 transition-colors', checked ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-line-strong')}>
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-ember-500"
              checked={checked}
              onChange={() => onChange(checked ? value.filter((k) => k !== role.key) : [...value, role.key])}
            />
            <span>
              <span className="block text-[13.5px] font-medium">{role.name}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function UserDialog({ open, user, roles, onClose }) {
  const queryClient = useQueryClient();
  const editing = Boolean(user);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleKeys, setRoleKeys] = useState([]);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setEmail(user?.email ?? '');
      setName(user?.name ?? '');
      setRoleKeys(user?.roles.map((r) => r.key) ?? ['payroll_manager']);
    }
  }

  const save = useMutation({
    mutationFn: () => (editing ? apiPatch(`/api/users/${user.id}`, { name, roleKeys }) : apiPost('/api/users', { email, name, roleKeys })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.users });
      toast.success(editing ? 'Access updated' : `${name} added`);
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { save.reset(); onClose(); } }}>
      <DialogContent title={editing ? `Edit ${user.name}` : 'Add teammate'} description={editing ? user.email : undefined}>
        <form id="user-form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4 px-6 pb-6 pt-4">
          {!editing && <Field label="Work email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>}
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Roles"><RolePicker roles={roles} value={roleKeys} onChange={setRoleKeys} /></Field>
          <ErrorNote error={save.error} />
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="dark" type="submit" form="user-form" disabled={!roleKeys.length} loading={save.isPending}>{editing ? 'Save' : 'Add user'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TeamModule() {
  const { user: me, can } = useAuth();
  const [tab, setTab] = useState('people');
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: qk.users, queryFn: async () => (await apiGet('/api/users')).items });
  const roles = useQuery({ queryKey: qk.roles, queryFn: async () => (await apiGet('/api/roles')).items });
  const [dialog, setDialog] = useState(null);

  const toggleActive = useMutation({
    mutationFn: (u) => apiPatch(`/api/users/${u.id}`, { isActive: !u.isActive }),
    onSuccess: (u) => {
      queryClient.invalidateQueries({ queryKey: qk.users });
      toast.success(u.isActive ? `${u.name} reactivated` : `${u.name} deactivated`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Team & access"
        actions={tab === 'people' && <Button variant="primary" disabled={!roles.data} onClick={() => setDialog({ user: null })} aria-label="Add teammate" title="Add teammate" className="max-sm:w-9 max-sm:px-0"><UserPlus /> <span className="max-sm:hidden">Add teammate</span></Button>}
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'people', label: 'People', count: users.data?.length },
          { value: 'roles', label: 'Roles', count: roles.data?.length },
        ]}
      />
      {tab === 'roles' ? <RolesPanel canManage={can(PERM.ROLES_MANAGE)} /> : (
      <Card className="overflow-hidden">
        {users.isPending ? (
          <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : users.error ? (
          <div className="p-5"><ErrorNote error={users.error} /></div>
        ) : (
          <ul className="divide-y divide-line">
            {users.data.map((u) => (
              <li key={u.id} className={cn('flex items-center gap-4 px-5 py-3.5', !u.isActive && 'opacity-55')}>
                <Avatar name={u.name} className="size-9" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate text-[13.5px] font-medium">
                    {u.name}
                    {u.id === me.id && <span className="text-[11.5px] font-normal text-ink-3">(you)</span>}
                    {!u.isActive && <Badge>Deactivated</Badge>}
                  </div>
                  <div className="truncate text-[12.5px] text-ink-3">{u.email}</div>
                </div>
                <div className="hidden flex-wrap justify-end gap-1.5 sm:flex">
                  {u.roles.map((r) => <Badge key={r.key} tone={r.key === 'super_admin' ? 'dark' : 'neutral'}>{r.name}</Badge>)}
                </div>
                <div className="hidden w-28 text-right text-[12px] text-ink-3 md:block">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : '—'}</div>
                {u.id !== me.id ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${u.name}`}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => setDialog({ user: u })}>Edit roles</DropdownMenuItem>
                      <DropdownMenuItem destructive={u.isActive} onSelect={() => toggleActive.mutate(u)}>
                        {u.isActive ? 'Deactivate' : 'Reactivate'}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className="size-8" />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      )}
      {roles.data && <UserDialog open={Boolean(dialog)} user={dialog?.user} roles={roles.data} onClose={() => setDialog(null)} />}
    </>
  );
}
