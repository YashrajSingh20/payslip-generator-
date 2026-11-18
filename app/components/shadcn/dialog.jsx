'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay() {
  return <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-cocoa/25 backdrop-blur-sm data-[state=open]:animate-fade-in" />;
}

function CloseButton() {
  return (
    <DialogPrimitive.Close className="absolute right-3.5 top-3.5 grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-sand hover:text-ink" aria-label="Close">
      <X className="size-4" />
    </DialogPrimitive.Close>
  );
}

/** Centered modal. */
export function DialogContent({ className, children, title, description, ...props }) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'glass-strong fixed inset-x-3 bottom-3 z-50 max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl scroll-thin data-[state=open]:animate-pop-in',
          'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[8vh] sm:w-full sm:max-w-lg sm:-translate-x-1/2',
          className,
        )}
        {...props}
      >
        <div className="px-6 pb-1 pt-5">
          <DialogPrimitive.Title className="pr-8 text-[17px] font-semibold tracking-tight text-ink">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className={cn('mt-1 text-[13px] text-ink-3', !description && 'sr-only')}>
            {description || title}
          </DialogPrimitive.Description>
        </div>
        {children}
        <CloseButton />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Side panel on desktop, bottom sheet on phones. */
export function SheetContent({ className, children, title, description, hideClose = false, ...props }) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'glass-strong fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-2xl data-[state=open]:animate-slide-in',
          'md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[min(1040px,94vw)] md:rounded-none md:rounded-l-2xl',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">{description || title}</DialogPrimitive.Description>
        {children}
        {!hideClose && <CloseButton />}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ className, ...props }) {
  return <div className={cn('flex flex-col-reverse gap-2 border-t border-white/70 bg-white/40 px-6 py-4 sm:flex-row sm:justify-end', className)} {...props} />;
}
