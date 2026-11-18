'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, CircleDashed, Info, OctagonAlert } from 'lucide-react';
import { useId } from 'react';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

export function Card({ className, ...props }) {
  return <div className={cn('glass rounded-2xl', className)} {...props} />;
}

export function PageHeader({ eyebrow, title, description, actions, children }) {
  return (
    <header className="flex items-center justify-between gap-3 pb-6 sm:items-end sm:gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="font-display text-[34px] leading-[1.05] tracking-[-0.01em] text-ink sm:text-[40px]">{title}</h1>
        {description && <p className="mt-2 max-w-xl text-[13.5px] text-ink-3">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 max-lg:mr-12">{actions}</div>}
    </header>
  );
}

const TONES = {
  neutral: 'border-line-strong bg-sand text-ink-2',
  ok: 'border-moss-line bg-moss-bg text-moss',
  warn: 'border-amber-line bg-amber-bg text-amber',
  bad: 'border-rust-line bg-rust-bg text-rust',
  brand: 'border-ember-100 bg-ember-50 text-ember-700',
  dark: 'border-ink bg-ink text-white',
};

export function Badge({ tone = 'neutral', dot = false, className, children }) {
  return (
    <span className={cn('inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[11.5px] font-medium', TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/**
 * Run state as a small mark beside plain text (no pill): a half-filled ring for
 * a draft still in progress, a solid check once approved.
 */
export function RunStatusBadge({ status, className }) {
  const approved = status === 'approved';
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium leading-none', approved ? 'text-moss' : 'text-ink-2', className)}>
      <svg viewBox="0 0 14 14" className="size-3.5 shrink-0" aria-hidden>
        {approved ? (
          <>
            <circle cx="7" cy="7" r="7" fill="currentColor" />
            <path d="M4.2 7.2 6.1 9l3.7-4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : (
          <>
            <circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" />
            <path d="M7 3.25a3.75 3.75 0 0 1 0 7.5Z" fill="#c46a12" />
          </>
        )}
      </svg>
      {approved ? 'Approved' : 'Draft'}
    </span>
  );
}

const SEVERITY = {
  blocking: { tone: 'bad', label: 'Blocking', Icon: OctagonAlert },
  warning: { tone: 'warn', label: 'Warning', Icon: AlertTriangle },
  info: { tone: 'neutral', label: 'Info', Icon: Info },
};

export function SeverityBadge({ severity }) {
  const s = SEVERITY[severity] ?? SEVERITY.info;
  return (
    <Badge tone={s.tone}>
      <s.Icon className="size-3" aria-hidden />
      {s.label}
    </Badge>
  );
}

export function SeverityIcon({ severity, className }) {
  const s = SEVERITY[severity] ?? SEVERITY.info;
  const color = { bad: 'text-rust', warn: 'text-amber', neutral: 'text-ink-3' }[s.tone];
  return <s.Icon className={cn('size-4 shrink-0', color, className)} aria-label={s.label} />;
}

export function EmailStatus({ status, error }) {
  if (!status) return <span className="text-[12.5px] text-ink-4">Not sent</span>;
  const map = {
    sent: { tone: 'ok', label: 'Sent', Icon: CheckCircle2 },
    pending: { tone: 'neutral', label: 'Queued', Icon: CircleDashed },
    sending: { tone: 'neutral', label: 'Sending', Icon: CircleDashed },
    failed: { tone: 'bad', label: 'Failed', Icon: OctagonAlert },
  }[status];
  return (
    <span title={error ?? undefined}>
      <Badge tone={map.tone}>
        <map.Icon className={cn('size-3', status === 'sending' && 'animate-spin')} aria-hidden />
        {map.label}
      </Badge>
    </span>
  );
}

export function Stat({ label, value, hint, tone, className }) {
  return (
    <div className={cn('min-w-0 px-5 py-4', className)}>
      <div className="eyebrow">{label}</div>
      <div className={cn('num mt-1.5 truncate text-[22px] font-semibold tracking-tight text-ink', tone === 'bad' && 'text-rust', tone === 'brand' && 'text-ember-600')}>
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-[12px] text-ink-3">{hint}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-16 text-center', className)}>
      {Icon && (
        <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-line bg-paper text-ink-3">
          <Icon className="size-5" />
        </div>
      )}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-3">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cn('skeleton h-4', className)} />;
}

export function Avatar({ name, className }) {
  return (
    <span className={cn('grid size-8 shrink-0 place-items-center rounded-full bg-sand-2 text-[11.5px] font-semibold text-ink-2', className)} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Checkbox({ className, indeterminate = false, ...props }) {
  return (
    <input
      type="checkbox"
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      className={cn('size-4 cursor-pointer rounded border-line-strong accent-ember-500', className)}
      {...props}
    />
  );
}

export function Field({ label, hint, error, children, className, htmlFor }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-ink-2">
          {label}
        </label>
      )}
      {children}
      {error ? <p className="text-[12px] text-rust">{error}</p> : hint ? <p className="text-[12px] leading-relaxed text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function Tabs({ value, onChange, items, className }) {
  const id = useId();
  return (
    <div role="tablist" className={cn('flex gap-1 border-b border-white/70', className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative -mb-px flex h-10 items-center gap-2 px-3 text-[13.5px] font-medium transition-colors',
              active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={cn('num rounded-full px-1.5 text-[11px] transition-colors duration-200', active ? 'bg-ink text-white' : 'bg-sand text-ink-3')}>{item.count}</span>
            )}
            {active && (
              <motion.span
                layoutId={`tab-underline-${id}`}
                transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-ember-500"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Pill-style segmented control with a sliding highlight. */
export function Segmented({ value, onChange, items }) {
  const id = useId();
  return (
    <div className="flex gap-1 rounded-lg bg-sand/70 p-1">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            onClick={() => onChange(item.value)}
            className={cn('relative h-7 rounded-md px-2.5 text-[12.5px] font-medium transition-colors duration-200', active ? 'text-ink' : 'text-ink-3 hover:text-ink')}
          >
            {active && (
              <motion.span
                layoutId={`segment-${id}`}
                transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                className="absolute inset-0 rounded-md bg-white shadow-card"
              />
            )}
            <span className="relative">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Fades content in when `id` changes (tab panels). */
export function FadeSwap({ id, children }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export function ErrorNote({ error, className }) {
  if (!error) return null;
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border border-rust-line bg-rust-bg px-3 py-2.5 text-[13px] text-rust', className)} role="alert">
      <OctagonAlert className="mt-px size-4 shrink-0" />
      <div>
        {error.message ?? String(error)}
        {error.requestId && <span className="ml-1 font-mono text-[11px] opacity-60">({error.requestId.slice(0, 8)})</span>}
      </div>
    </div>
  );
}
