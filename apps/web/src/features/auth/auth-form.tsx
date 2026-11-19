'use client';

import { ArrowRight, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { getErrorMessage } from '@/lib/format';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const { isAuthenticated, isLoading, login, register } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/analytics');
    }
  }, [isLoading, isAuthenticated, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    const trimmedName = name.trim();

    if (mode === 'register' && trimmedName.length < 2) {
      setError('Full name must be at least 2 characters.');
      return;
    }
    if (!trimmedEmail) {
      setError('Email address is required.');
      return;
    }
    if (mode === 'register' && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (mode === 'login' && password.length < 1) {
      setError('Password is required.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'register') {
        await register({ name: trimmedName, email: trimmedEmail, password });
        router.replace('/organizations');
      } else {
        await login({ email: trimmedEmail, password });
        router.replace('/analytics');
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Authentication failed. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const isRegister = mode === 'register';

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-50 via-slate-50 to-sky-50/70 px-4 py-12">
      <div className="animate-scale-in w-full max-w-md rounded-2xl border border-slate-200/90 bg-white/95 p-8 shadow-lg shadow-slate-200/50 backdrop-blur">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-600 transition hover:text-indigo-700"
        >
          <ShieldCheck className="h-4 w-4" />
          Enterprise Knowledge AI
        </Link>

        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
          {isRegister ? 'Create your account' : 'Sign in to your workspace'}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {isRegister
            ? 'Start managing organization knowledge bases and grounded AI answers.'
            : 'Enter your credentials to access your organization documents and chat.'}
        </p>

        {error ? (
          <div
            role="alert"
            className="animate-fade-in-up mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            {error}
          </div>
        ) : null}

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-4">
          {isRegister ? (
            <div>
              <label
                htmlFor="auth-name"
                className="block text-sm font-medium text-slate-700"
              >
                Full name
              </label>
              <input
                id="auth-name"
                type="text"
                autoComplete="name"
                required
                minLength={2}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          ) : null}

          <div>
            <label
              htmlFor="auth-email"
              className="block text-sm font-medium text-slate-700"
            >
              Work email
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ada@company.com"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div>
            <label
              htmlFor="auth-password"
              className="block text-sm font-medium text-slate-700"
            >
              Password
            </label>
            <div className="relative mt-1.5">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                required
                minLength={isRegister ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  isRegister ? 'Minimum 8 characters' : 'Your password'
                }
                className="w-full rounded-lg border border-slate-300 py-2 pl-3.5 pr-10 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:bg-indigo-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isRegister ? 'Creating account...' : 'Signing in...'}
              </>
            ) : (
              <>
                {isRegister ? 'Create account' : 'Sign in'}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          {isRegister ? (
            <>
              Already have an account?{' '}
              <Link
                href="/login"
                className="font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Sign in
              </Link>
            </>
          ) : (
            <>
              Need an account?{' '}
              <Link
                href="/register"
                className="font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Create one
              </Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
