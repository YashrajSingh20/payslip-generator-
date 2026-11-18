'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { OTPInput, REGEXP_ONLY_DIGITS } from 'input-otp';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

const OTP_LENGTH = 6;

/** Same as the Team Portal: company domains only, so people type just the name. */
const DOMAINS = [
  'keystonecommerce.in',
  'liwip.com',
  ...(process.env.NODE_ENV === 'development' ? ['keystone.test'] : []),
];

function OtpSlot({ char, isActive, hasFakeCaret }) {
  return (
    <div
      className={cn(
        'relative grid h-[52px] w-full place-items-center rounded-xl border bg-paper font-mono text-[20px] font-medium text-ink transition-all',
        isActive ? 'border-ink-4 bg-surface ring-4 ring-ink/[0.04]' : 'border-sand-2',
      )}
    >
      {char}
      {hasFakeCaret && <span className="absolute h-6 w-px animate-pulse bg-ink" />}
    </div>
  );
}

export function LoginScreen() {
  const { signedIn } = useAuth();
  const [username, setUsername] = useState('');
  const [domain, setDomain] = useState(DOMAINS[0]);
  const [code, setCode] = useState('');
  const [step, setStep] = useState(1);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const email = `${username.trim().toLowerCase()}@${domain}`;
  const showAddressHint = step === 1 && username.trim().length > 0;

  /** Autofill and paste deliver a whole address; split it into name + domain. */
  function onUsernameChange(e) {
    const raw = e.target.value;
    if (!raw.includes('@')) {
      setUsername(raw);
      return;
    }
    const [local, rest = ''] = raw.split('@');
    const match = DOMAINS.find((d) => d === rest.trim().toLowerCase());
    setUsername(local);
    if (match) setDomain(match);
  }

  async function sendCode(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiPost('/api/auth/send-otp', { email });
      setCode('');
      setStep(2);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  async function verify(e) {
    e?.preventDefault();
    if (code.length !== OTP_LENGTH || loading) return;
    setError(null);
    setLoading(true);
    try {
      const { user } = await apiPost('/api/auth/verify-otp', { email, code });
      signedIn(user);
    } catch (err) {
      setError(err);
      setCode('');
      setLoading(false);
    }
  }

  const errorNote = error && (
    <p className="text-[14px] font-medium text-rust" role="alert">
      {error.message ?? String(error)}
      {error.requestId && <span className="mt-1 block break-all text-[12px] text-ink-3">Reference: {error.requestId}</span>}
    </p>
  );

  const submitButton = (label) => (
    <button
      type="submit"
      disabled={loading}
      className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-ember-500 text-[15px] font-semibold text-white transition-colors hover:bg-ember-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ember-500/20 disabled:opacity-50"
    >
      {loading && <LoaderCircle className="size-5 animate-spin" />}
      {label}
    </button>
  );

  return (
    <main className="grid h-[100dvh] place-items-center overflow-hidden bg-paper px-5 py-6">
      <div className="w-full max-w-[400px]">
        <h1 className="mb-5 flex items-center gap-4 leading-none">
          <img src="/brand/logo-keystone.png" alt="Keystone Commerce" className="h-9 w-auto" />
          <span className="h-7 w-px bg-ink/15" aria-hidden />
          <img src="/brand/logo-liwip-light.png" alt="Liwip, Live With Pride" className="h-10 w-auto" />
          <span className="sr-only">Payroll sign in</span>
        </h1>

        <section aria-labelledby="sign-in-heading" className="rounded-[24px] border border-sand-2 bg-surface p-5 sm:p-7">
          <h2
            id="sign-in-heading"
            className={cn('text-[16px] font-semibold leading-none text-ink', showAddressHint ? 'mb-1.5' : 'mb-5')}
          >
            {showAddressHint ? 'Sign in as' : 'Sign in'}
          </h2>
          {showAddressHint && (
            <p className="mb-5 break-all text-[14px] font-semibold leading-5 text-ink" aria-live="polite">
              {email}
            </p>
          )}

          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.form
                key="step1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                onSubmit={sendCode}
                className="space-y-4"
              >
                <div>
                  <label htmlFor="login-email" className="sr-only">Work email</label>
                  {/* Name and domain read as one field, so the ring lives on the wrapper. */}
                  <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-sand-2 bg-surface transition-[border-color,box-shadow] focus-within:border-ink-4 focus-within:ring-4 focus-within:ring-ink/[0.04]">
                    <input
                      id="login-email"
                      type="text"
                      value={username}
                      required
                      autoFocus
                      placeholder="name"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck="false"
                      onChange={onUsernameChange}
                      className="min-h-[52px] w-full min-w-0 flex-1 bg-transparent px-4 text-[16px] text-ink caret-ember-500 outline-none placeholder:text-ink-4 focus-visible:ring-0 focus-visible:ring-offset-0 autofill:shadow-[inset_0_0_0_1000px_#fff] autofill:[-webkit-text-fill-color:#1d1511]"
                    />
                    <span aria-hidden="true" className="mx-4 h-px shrink-0 bg-sand-2" />
                    {/* The span sets the width; the transparent select sits on top of it. */}
                    <div className="relative grid w-full items-center px-4 pb-1.5">
                      <span aria-hidden="true" className="col-start-1 row-start-1 whitespace-nowrap pr-5 text-[16px] text-ink-3">
                        @{domain}
                      </span>
                      <select
                        aria-label="Email domain"
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                        className="col-start-1 row-start-1 min-h-11 w-full cursor-pointer appearance-none rounded-xl bg-transparent pr-5 text-[16px] text-transparent outline-none focus-visible:bg-sand focus-visible:ring-0 focus-visible:ring-offset-0 [&>option]:text-ink"
                      >
                        {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <ChevronDown size={15} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-ink-3" />
                    </div>
                  </div>
                </div>
                {errorNote}
                {submitButton('Send login code')}
              </motion.form>
            ) : (
              <motion.form
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                onSubmit={verify}
                className="space-y-4"
              >
                <div>
                  <label htmlFor="login-otp" className="mb-3 block break-all text-[14px] leading-5 text-ink-3">
                    Code sent to <span className="font-semibold text-ink">{email}</span>
                  </label>
                  <OTPInput
                    id="login-otp"
                    aria-label="Login code"
                    value={code}
                    onChange={setCode}
                    maxLength={OTP_LENGTH}
                    pattern={REGEXP_ONLY_DIGITS}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    containerClassName="w-full"
                    render={({ slots }) => (
                      <div className="grid grid-cols-6 gap-2">
                        {slots.map((slot, i) => <OtpSlot key={i} {...slot} />)}
                      </div>
                    )}
                  />
                </div>
                {errorNote}
                {submitButton('Sign in')}
                <button
                  type="button"
                  onClick={() => { setStep(1); setCode(''); setError(null); }}
                  className="min-h-11 w-full rounded-xl text-center text-[14px] font-semibold text-ink-3 transition-colors hover:text-ember-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ember-500/10"
                >
                  Use a different email
                </button>
                {process.env.NODE_ENV === 'development' && (
                  <p className="text-center text-[12px] text-ink-4">
                    Dev code: <span className="font-mono text-ink-2">123456</span>
                  </p>
                )}
              </motion.form>
            )}
          </AnimatePresence>
        </section>
      </div>
    </main>
  );
}
