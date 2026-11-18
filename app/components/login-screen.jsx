'use client';

import { OTPInput } from 'input-otp';
import { ArrowLeft, ArrowRight, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { AmbientGlow } from './ambient-glow';
import { Button } from './shadcn/button';
import { Input } from './shadcn/input';
import { ErrorNote, Field } from './ui';

const RESEND_SECONDS = 45;


/** Keystone | Liwip, sized so the two wordmarks read at the same height. */
function LogoPair() {
  return (
    <div className="flex items-center gap-4">
      <img src="/brand/logo-keystone.png" alt="Keystone Commerce" className="h-8 w-auto" />
      <span className="h-7 w-px bg-ink/20" aria-hidden />
      <img src="/brand/logo-liwip-light.png" alt="Liwip, Live With Pride" className="h-9 w-auto" />
    </div>
  );
}

function OtpSlot({ char, isActive, hasFakeCaret }) {
  return (
    <div
      className={cn(
        'relative grid h-14 w-full place-items-center rounded-xl border bg-surface font-mono text-[22px] font-medium text-ink transition-all',
        isActive ? 'border-ember-500 ring-[3px] ring-ember-500/15' : 'border-line-strong',
      )}
    >
      {char}
      {hasFakeCaret && <span className="absolute h-6 w-px animate-pulse bg-ink" />}
    </div>
  );
}

export function LoginScreen() {
  const { signedIn } = useAuth();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode(event) {
    event?.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiPost('/api/auth/send-otp', { email });
      setStep('code');
      setCode('');
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }

  async function verify(value = code) {
    if (value.length !== 6 || pending) return;
    setPending(true);
    setError(null);
    try {
      const { user } = await apiPost('/api/auth/verify-otp', { email, code: value });
      signedIn(user);
    } catch (e) {
      setError(e);
      setCode('');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col">
      <AmbientGlow />
      <div className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-6 sm:px-10">
        {/* Phones: logos at the top. Larger screens show them above the title. */}
        <header className="pt-[max(1.75rem,env(safe-area-inset-top))] lg:hidden">
          <LogoPair />
        </header>

        <div className="grid flex-1 content-start gap-8 pb-8 pt-14 sm:content-center sm:pt-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:content-normal lg:items-center lg:gap-20 lg:py-16">
          <h2 className="font-display text-[44px] leading-none tracking-[-0.01em] text-ink sm:mx-auto sm:w-full sm:max-w-[400px] lg:hidden">
            Keystone <em className="text-ember-500">Payroll</em>
          </h2>

          {/* Brand side */}
          <section className="hidden lg:block">
            <LogoPair />
            <h2 className="mt-10 font-display text-[72px] leading-[0.95] tracking-[-0.02em] text-ink xl:text-[84px]">
              Keystone <em className="text-ember-500">Payroll</em>
            </h2>
          </section>

        <div className="w-full sm:glass sm:mx-auto sm:max-w-[400px] sm:rounded-3xl sm:p-10 lg:mx-0 lg:justify-self-end">
          {step === 'email' ? (
            <form onSubmit={sendCode} className="animate-pop-in">
              <h1 className="font-display text-[40px] leading-none max-sm:sr-only">Sign in</h1>
              <Field label="Work email" htmlFor="email" className="sm:mt-8">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  placeholder="you@keystonecommerce.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 text-[16px] sm:h-11 sm:text-[15px]"
                />
              </Field>
              <ErrorNote error={error} className="mt-4" />
              <Button type="submit" variant="dark" size="lg" className="mt-5 h-12 w-full sm:h-11" loading={pending}>
                Continue <ArrowRight />
              </Button>
            </form>
          ) : (
            <div className="animate-pop-in">
              <button onClick={() => { setStep('email'); setError(null); }} className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
                <ArrowLeft className="size-4" /> Use a different email
              </button>
              <div className="mb-5 grid size-11 place-items-center rounded-xl bg-ember-50 text-ember-600">
                <Mail className="size-5" />
              </div>
              <h1 className="font-display text-[40px] leading-none">Enter code</h1>
              <p className="mt-2 text-[14px] text-ink-3">Sent to <span className="font-medium text-ink-2">{email}</span></p>
              <OTPInput
                maxLength={6}
                value={code}
                onChange={setCode}
                onComplete={verify}
                autoFocus
                inputMode="numeric"
                pattern="^\d*$"
                containerClassName="mt-8"
                render={({ slots }) => (
                  <div className="grid grid-cols-6 gap-2">
                    {slots.map((slot, i) => <OtpSlot key={i} {...slot} />)}
                  </div>
                )}
              />
              <ErrorNote error={error} className="mt-4" />
              <Button variant="dark" size="lg" className="mt-5 h-12 w-full sm:h-11" loading={pending} onClick={() => verify()}>
                Sign in
              </Button>
              <div className="mt-4 text-center text-[13px] text-ink-3">
                {cooldown > 0 ? (
                  <span className="num">Resend code in {cooldown}s</span>
                ) : (
                  <button onClick={sendCode} className="font-medium text-ember-600 hover:underline">Resend code</button>
                )}
              </div>
              {process.env.NODE_ENV === 'development' && (
                <p className="mt-8 text-center text-[12px] text-ink-4">
                  Dev code: <span className="font-mono text-ink-2">123456</span>
                </p>
              )}
            </div>
          )}
        </div>

        </div>

        <footer className="flex justify-center border-t border-ink/[0.06] pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 text-[12px] text-ink-4 lg:justify-start">
          <span>© {new Date().getFullYear()} Keystone Commerce Private Limited</span>
        </footer>
      </div>
    </div>
  );
}
