'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-ember-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(187,51,7,0.35)] hover:bg-ember-600',
        dark: 'bg-ink text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-ink-2',
        outline: 'border border-line-strong bg-surface text-ink shadow-card hover:border-ink-4 hover:bg-white/60',
        ghost: 'text-ink-2 hover:bg-sand hover:text-ink',
        danger: 'border border-rust-line bg-surface text-rust hover:bg-rust-bg',
        link: 'h-auto px-0 text-ember-600 underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-9 px-3.5 text-[13.5px]',
        lg: 'h-11 px-5 text-[15px]',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);

export const Button = forwardRef(function Button({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {asChild ? children : (
        <>
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
});
