'use client';

import { MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth';
import { QueryProvider } from '@/lib/query-provider';
import { PayrollApp } from './payroll-app';

export default function Page() {
  return (
    <QueryProvider>
      <AuthProvider>
        {/* Animations respect the OS "reduce motion" setting. */}
        <MotionConfig reducedMotion="user">
          <PayrollApp />
        </MotionConfig>
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: '!rounded-xl !border-white/80 !bg-white/80 !backdrop-blur-xl !text-ink !shadow-pop !font-sans',
              description: '!text-ink-3',
            },
          }}
        />
      </AuthProvider>
    </QueryProvider>
  );
}
