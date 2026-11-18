'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/cn';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({ className, align = 'end', ...props }) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={6}
        className={cn('glass-strong z-50 min-w-48 rounded-xl p-1 data-[state=open]:animate-pop-in', className)}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({ className, destructive = false, ...props }) {
  return (
    <Menu.Item
      className={cn(
        'flex cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-2 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-sand data-[highlighted]:text-ink data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-ink-3',
        destructive && 'text-rust data-[highlighted]:bg-rust-bg data-[highlighted]:text-rust [&_svg]:text-rust',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }) {
  return <Menu.Label className={cn('px-2.5 pb-1 pt-2 text-2xs font-medium uppercase tracking-[0.08em] text-ink-3', className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="-mx-1 my-1 h-px bg-line" />;
}
