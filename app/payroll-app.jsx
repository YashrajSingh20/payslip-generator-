'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Layers, LogOut, RotateCw, ShieldCheck, SlidersHorizontal, Users } from 'lucide-react';
import { AmbientGlow } from './components/ambient-glow';
import { EmployeesModule } from './components/employees-module';
import { LoginScreen } from './components/login-screen';
import { RunDetail } from './components/run-detail';
import { RunsModule } from './components/runs-module';
import { SettingsModule } from './components/settings-module';
import { Button } from './components/shadcn/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './components/shadcn/dropdown-menu';
import { Avatar, EmptyState, Skeleton } from './components/ui';
import { TeamModule } from './components/team-module';
import { PERM, useAuth } from './lib/auth';
import { cn } from './lib/cn';
import { useHashRoute } from './lib/use-hash-route';

const NAV = [
  { path: '/runs', label: 'Payroll runs', short: 'Runs', icon: Layers, perm: PERM.PAYROLL_READ },
  { path: '/employees', label: 'Employees', short: 'People', icon: Users, perm: PERM.EMPLOYEES_READ },
  { path: '/settings', label: 'Settings', short: 'Settings', icon: SlidersHorizontal, perm: PERM.PAYROLL_READ },
  { path: '/team', label: 'Team & access', short: 'Team', icon: ShieldCheck, perm: PERM.USERS_MANAGE },
];

function UserMenu({ compact = false }) {
  const { user, signOut } = useAuth();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn('flex min-w-0 items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-white/60', compact ? 'p-1' : 'w-full p-2')}>
          <Avatar name={user.name} />
          {!compact && (
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-ink">{user.name}</span>
              <span className="block truncate text-[12px] text-ink-3">{user.email}</span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? 'end' : 'start'} side={compact ? 'bottom' : 'top'}>
        <DropdownMenuLabel>Signed in as</DropdownMenuLabel>
        <div className="px-2.5 pb-2 text-[13px] text-ink">{user.email}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SPRING = { type: 'spring', stiffness: 420, damping: 34 };

function Shell({ nav, active, children }) {
  return (
    <div className="relative min-h-dvh lg:pl-[248px]">
      <AmbientGlow />
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-white/70 bg-white/50 backdrop-blur-2xl backdrop-saturate-150 lg:flex">
        <div className="flex items-center gap-2.5 px-5 pb-6 pt-6">
          <img src="/brand/logo-keystone.png" alt="Keystone Commerce" className="h-[22px] w-auto" />
          <span className="h-5 w-px bg-line-strong" aria-hidden />
          <img src="/brand/logo-liwip-light.png" alt="Liwip, Live With Pride" className="h-6 w-auto" />
        </div>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
          {nav.map((item) => {
            const isActive = active === item.path;
            return (
              <a
                key={item.path}
                href={`#${item.path}`}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors duration-200',
                  isActive ? 'text-white' : 'text-ink-2 hover:bg-white/60 hover:text-ink',
                )}
              >
                {isActive && <motion.span layoutId="nav-active" transition={SPRING} className="absolute inset-0 rounded-lg bg-ink shadow-[0_6px_16px_-6px_rgba(29,21,17,0.45)]" />}
                <item.icon className={cn('relative size-4 transition-colors', isActive ? 'text-ember-500' : 'text-ink-3 group-hover:text-ink-2')} />
                <span className="relative">{item.label}</span>
              </a>
            );
          })}
        </nav>
        <div className="border-t border-white/70 p-3">
          <UserMenu />
        </div>
      </aside>

      <main className="relative mx-auto w-full max-w-[1320px] px-4 pb-28 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">
        {/* Mobile: account menu only, no logo bar */}
        <div className="absolute right-3 top-[max(1.25rem,env(safe-area-inset-top))] z-20 sm:right-5 lg:hidden">
          <UserMenu compact />
        </div>
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-white/70 bg-white/60 backdrop-blur-2xl backdrop-saturate-150 lg:hidden"
        style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))`, paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Main"
      >
        {nav.map((item) => {
          const isActive = active === item.path;
          return (
            <a key={item.path} href={`#${item.path}`} className={cn('relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors', isActive ? 'text-ink' : 'text-ink-3')}>
              {isActive && <motion.span layoutId="mobile-nav-active" transition={SPRING} className="absolute top-0 h-0.5 w-8 rounded-full bg-ember-500" />}
              <item.icon className={cn('size-5 transition-colors', isActive && 'text-ember-500')} />
              {item.short}
            </a>
          );
        })}
      </nav>
    </div>
  );
}

function SplashSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-10">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="mt-8 h-48 w-full" />
    </div>
  );
}

export function PayrollApp() {
  const { user, loading, error, retry, can } = useAuth();
  const { segments, navigate } = useHashRoute();

  if (loading) return <SplashSkeleton />;
  if (error) {
    return (
      <EmptyState
        className="min-h-dvh justify-center"
        icon={RotateCw}
        title="Can't reach Keystone Payroll"
        description={error.message}
        action={<Button onClick={() => retry()}>Try again</Button>}
      />
    );
  }
  if (!user) return <LoginScreen />;

  const nav = NAV.filter((item) => can(item.perm));
  const section = `/${segments[0] ?? ''}`;
  const active = nav.some((n) => n.path === section) ? section : nav[0]?.path;

  let content;
  if (!nav.length) {
    content = <EmptyState icon={ShieldCheck} title="No access" description="Ask an admin to assign a role." />;
  } else if (active === '/runs' && segments[1]) {
    content = <RunDetail runId={segments[1]} navigate={navigate} />;
  } else if (active === '/runs') {
    content = <RunsModule navigate={navigate} />;
  } else if (active === '/employees') {
    content = <EmployeesModule />;
  } else if (active === '/settings') {
    content = <SettingsModule />;
  } else if (active === '/team') {
    content = <TeamModule />;
  }

  return (
    <Shell nav={nav} active={active}>
      {process.env.NEXT_PUBLIC_FRONTEND_ONLY === 'true' && (
        <p role="status" className="mb-5 rounded-xl border border-line bg-white/60 px-4 py-3 text-[13px] text-ink-3">
          UI preview · No sign-in needed. Uploads, changes and emails are unavailable.
        </p>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={active + (segments[1] ?? '')}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {content}
        </motion.div>
      </AnimatePresence>
    </Shell>
  );
}
