'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleSlash, ImageUp, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPost, apiPut, fileToBase64 } from '@/lib/api';
import { PERM, useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query-keys';
import { Button } from './shadcn/button';
import { Input, Select, Textarea } from './shadcn/input';
import { Card, ErrorNote, Field, PageHeader, Skeleton } from './ui';

const TOKENS = ['Name', 'EmployeeID', 'Month', 'Year', 'NetPay', 'Currency', 'Designation'];
const SAMPLE = { Name: 'Manmohan Thakur', EmployeeID: '10003', Month: 'July', Year: '2026', NetPay: '34,980.00', Currency: '₹', Designation: 'Warehouse Supervisor' };

const fill = (template, values) => template.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
const sampleFileName = (pattern) => {
  const safe = Object.fromEntries(Object.entries(SAMPLE).map(([k, v]) => [k, v.replace(/\s+/g, '_')]));
  const name = fill(pattern, safe).replace(/[\\/:*?"<>|]/g, '');
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
};

const LOGO_SLOTS = [
  { slot: 'primary', label: 'Left logo', field: 'logoPrimaryObjectId', fallback: '/brand/logo-keystone.png' },
  { slot: 'secondary', label: 'Right logo', field: 'logoSecondaryObjectId', fallback: '/brand/logo-liwip-light.png' },
];

/** One payslip logo: preview, upload (PNG/JPEG, stored privately in S3) and reset. */
function LogoSlot({ slot, label, field, fallback, settings, canEdit, onSaved }) {
  const input = useRef(null);
  const custom = settings[field];
  const upload = useMutation({
    mutationFn: async (file) => {
      if (file.size > 2 * 1024 * 1024) throw new Error('Logo must be 2 MB or smaller.');
      return apiPost(`/api/settings/logos/${slot}`, { fileName: file.name, contentBase64: await fileToBase64(file) }, { timeoutMs: 30_000 });
    },
    onSuccess: (data) => { onSaved(data); toast.success(`${label} updated`); },
    onError: (e) => toast.error(e.message),
  });
  const reset = useMutation({
    mutationFn: () => apiDelete(`/api/settings/logos/${slot}`),
    onSuccess: (data) => { onSaved(data); toast.success(`${label} reset`); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-white/50 p-3">
      <div className="grid h-12 w-24 shrink-0 place-items-center rounded-lg bg-white ring-1 ring-line">
        <img
          key={custom ?? 'default'}
          src={custom ? `/api/settings/logos/${slot}?v=${custom}` : fallback}
          alt={label}
          className="max-h-8 max-w-[84px] object-contain"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="whitespace-nowrap text-[13px] font-medium">{label}</div>
        <div className="text-[12px] text-ink-3">{custom ? 'Uploaded' : 'Default'}</div>
      </div>
      {canEdit && (
        <div className="flex shrink-0 gap-1.5">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate(f); }}
          />
          <Button type="button" size="sm" onClick={() => input.current?.click()} loading={upload.isPending} aria-label={`Upload ${label}`}>
            <ImageUp /> <span className="max-sm:hidden">Upload</span>
          </Button>
          {custom && (
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => reset.mutate()} loading={reset.isPending} aria-label={`Reset ${label}`} title="Use the default logo">
              <RotateCcw />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <Card className="grid gap-6 p-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function ProviderStatus({ provider }) {
  if (provider === 'dev-mock') return null;
  const map = {
    gmail: { Icon: CheckCircle2, text: 'Gmail connected', cls: 'border-moss-line bg-moss-bg text-moss' },
  }[provider] ?? { Icon: CircleSlash, text: 'Email not configured', cls: 'border-line-strong bg-sand text-ink-2' };
  return (
    <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] font-medium sm:col-span-2', map.cls)}>
      <map.Icon className="size-4" /> {map.text}
    </div>
  );
}

function TokenChips({ onInsert }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TOKENS.map((t) => (
        <button key={t} type="button" onClick={() => onInsert(`{${t}}`)} className="rounded-md bg-sand px-1.5 py-0.5 font-mono text-[11px] text-ink-2 transition-colors hover:bg-sand-2 hover:text-ink">
          {`{${t}}`}
        </button>
      ))}
    </div>
  );
}

export function SettingsModule() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = can(PERM.SETTINGS_MANAGE);
  const settings = useQuery({ queryKey: qk.settings, queryFn: () => apiGet('/api/settings') });
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (settings.data && !form) setForm(settings.data);
  }, [settings.data, form]);

  const logoSaved = (data) => {
    queryClient.setQueryData(qk.settings, data);
    setForm((f) => ({ ...f, logoPrimaryObjectId: data.logoPrimaryObjectId, logoSecondaryObjectId: data.logoSecondaryObjectId, updatedAt: data.updatedAt }));
  };

  const dirty = useMemo(() => form && settings.data && Object.keys(form).some((k) => form[k] !== settings.data[k]), [form, settings.data]);

  const save = useMutation({
    mutationFn: () => apiPut('/api/settings', form),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.settings, data);
      setForm(data);
      toast.success('Settings saved');
    },
  });

  if (settings.isPending || !form) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (settings.error) return <ErrorNote error={settings.error} />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const append = (k) => (token) => setForm({ ...form, [k]: `${form[k]}${token}` });

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <PageHeader
        title="Settings"
        actions={canEdit && (
          <>
            {dirty && <Button type="button" variant="ghost" onClick={() => setForm(settings.data)}>Discard</Button>}
            <Button type="submit" variant="dark" disabled={!dirty} loading={save.isPending}>Save changes</Button>
          </>
        )}
      />
      <ErrorNote error={save.error} className="mb-4" />
      <fieldset disabled={!canEdit} className="space-y-4">
        <Section title="Payslip">
          <Field label="Company name" className="sm:col-span-2"><Input value={form.companyName} onChange={set('companyName')} required /></Field>
          <Field label="CIN"><Input value={form.cin} onChange={set('cin')} className="font-mono" /></Field>
          <Field label="Registered office"><Input value={form.registeredOffice ?? ''} onChange={set('registeredOffice')} /></Field>
          <Field label="Currency prefix"><Input value={form.currencyPrefix} onChange={set('currencyPrefix')} required /></Field>
          <Field label="Footer text" className="sm:col-span-2"><Input value={form.footerText} onChange={set('footerText')} /></Field>
          <Field label="PDF file name" className="sm:col-span-2" hint={<>Example: <span className="font-mono text-ink-2">{sampleFileName(form.filenamePattern)}</span></>}>
            <Input value={form.filenamePattern} onChange={set('filenamePattern')} className="font-mono text-[12.5px]" required />
            <TokenChips onInsert={append('filenamePattern')} />
          </Field>
        </Section>

        <Section title="Logos">
          <p className="text-[12.5px] text-ink-3 sm:col-span-2">Printed at the top of payslips. PNG or JPEG, up to 2 MB. Used for runs created after the change.</p>
          {LOGO_SLOTS.map((s) => (
            <LogoSlot key={s.slot} {...s} settings={form} canEdit={canEdit} onSaved={logoSaved} />
          ))}
        </Section>

        <Section title="Email">
          <ProviderStatus provider={form.emailProvider} />
          <Field label="From name"><Input value={form.emailFromName} onChange={set('emailFromName')} required /></Field>
          <Field label="Send to">
            <Select value={form.recipientPreference} onChange={set('recipientPreference')}>
              <option value="official">Official email, else personal</option>
              <option value="personal">Personal email, else official</option>
            </Select>
          </Field>
          <Field label="Subject" className="sm:col-span-2"><Input value={form.emailSubject} onChange={set('emailSubject')} required /></Field>
          <Field label="Message" className="sm:col-span-2">
            <Textarea value={form.emailBody} onChange={set('emailBody')} rows={9} required />
            <TokenChips onInsert={append('emailBody')} />
          </Field>
          <div className="sm:col-span-2">
            <div className="eyebrow mb-2">Preview</div>
            <div className="rounded-xl border border-line bg-paper p-4">
              <div className="text-[13px] font-semibold">{fill(form.emailSubject, SAMPLE)}</div>
              <div className="mt-0.5 text-[12px] text-ink-3">{form.emailFromName} · {sampleFileName(form.filenamePattern)}</div>
              <div className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{fill(form.emailBody, SAMPLE)}</div>
            </div>
          </div>
        </Section>
      </fieldset>
    </form>
  );
}
