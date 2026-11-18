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
    <div className="relative grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <AmbientGlow />
      {/* Brand panel */}
      <aside className="relative hidden flex-col justify-between p-12 lg:flex">
        <img src="/brand/logo-liwip-light.png" alt="Liwip, Live With Pride" className="h-16 w-auto self-start" />

        <h2 className="font-display text-[56px] leading-[1.02] tracking-[-0.01em] text-ink">
          Keystone <em className="text-ember-500">Payroll</em>
        </h2>

        {/* Abstract payslip */}
        <div className="glass w-full max-w-sm rounded-2xl p-5">
          <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3">
            <span>Payslip · July 2026</span>
            <span className="num">10003</span>
          </div>
          <div className="mt-4 space-y-2.5">
            {[72, 54, 64, 40].map((w, i) => (
              <div key={i} className="flex items-center justify-between gap-6">
                <span className="h-1.5 rounded-full bg-ink/10" style={{ width: `${w}%` }} />
                <span className="h-1.5 w-14 rounded-full bg-ink/20" />
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between rounded-xl bg-cocoa-2 px-4 py-3 text-[13px] font-semibold text-white">
            <span className="text-white/70">NET PAY</span>
            <span className="num">₹34,980.00</span>
          </div>
        </div>
      </aside>

      {/* Form */}
      <main className="relative flex flex-col px-6 py-10 sm:px-12">
        <img src="/brand/logo-keystone.png" alt="Keystone Commerce" className="h-9 w-auto self-start" />

        <div className="glass mx-auto my-auto w-full max-w-sm rounded-3xl p-8">
          {step === 'email' ? (
            <form onSubmit={sendCode} className="animate-pop-in">
              <h1 className="font-display text-[38px] leading-tight">Sign in</h1>
              <Field label="Work email" htmlFor="email" className="mt-8">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  placeholder="you@keystonecommerce.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 text-[15px]"
                />
              </Field>
              <ErrorNote error={error} className="mt-4" />
              <Button type="submit" variant="dark" size="lg" className="mt-5 w-full" loading={pending} disabled={!email}>
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
              <h1 className="font-display text-[38px] leading-tight">Enter code</h1>
              <p className="mt-1.5 text-[14px] text-ink-3">Sent to {email}</p>
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
              <Button variant="dark" size="lg" className="mt-5 w-full" loading={pending} disabled={code.length !== 6} onClick={() => verify()}>
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

        <p className="text-[12px] text-ink-4">Keystone Commerce Private Limited</p>
      </main>
    </div>
  );
}
