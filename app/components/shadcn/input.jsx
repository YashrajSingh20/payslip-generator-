'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

const field =
  'w-full rounded-lg border border-line-strong bg-surface text-[13.5px] text-ink shadow-[inset_0_1px_1px_rgba(29,21,17,0.03)] transition-colors placeholder:text-ink-4 hover:border-ink-4 focus-visible:border-ember-500 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ember-500/15 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:bg-sand disabled:opacity-70 aria-[invalid=true]:border-rust';

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(field, 'h-9 px-3', className)} {...props} />;
});

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(field, 'min-h-28 px-3 py-2 leading-relaxed', className)} {...props} />;
});

export const Select = forwardRef(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        field,
        "h-9 appearance-none bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%238b7f77' stroke-width='1.5'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")] bg-[length:16px] bg-[right_10px_center] bg-no-repeat pl-3 pr-9",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export function Label({ className, ...props }) {
  return <label className={cn('text-[12.5px] font-medium text-ink-2', className)} {...props} />;
}
