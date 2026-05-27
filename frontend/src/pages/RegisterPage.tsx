import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiErrorMessage } from '../api/client';
import BrandLogo from '../components/BrandLogo';

export default function RegisterPage() {
  const { register, user } = useAuth();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const passwordsMatch = confirmPassword.length === 0 || password === confirmPassword;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4 py-10">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center gap-4">
          <BrandLogo className="h-20 w-20 drop-shadow-md" />
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Portfolio Tracker
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Create an account to start tracking your investments.
            </p>
          </div>
        </div>
        <form
          className="card space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (password !== confirmPassword) {
              setError('Passwords do not match.');
              return;
            }
            setSubmitting(true);
            setError(null);
            try { await register(email, password, displayName || undefined); }
            catch (err) { setError(apiErrorMessage(err)); }
            finally { setSubmitting(false); }
          }}
        >
          <h2 className="text-xl font-semibold">Create an account</h2>
          <div>
            <label className="label">Display name</label>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-slate-500 mt-1">At least 8 characters.</p>
          </div>
          <div>
            <label className="label">Confirm password</label>
            <input
              className={`input ${!passwordsMatch ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {!passwordsMatch && (
              <p className="text-xs text-red-600 mt-1">Passwords do not match.</p>
            )}
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <button
            className="btn-primary w-full"
            type="submit"
            disabled={submitting || !passwordsMatch || confirmPassword.length === 0}
          >
            {submitting ? 'Creating…' : 'Create account'}
          </button>
          <p className="text-sm text-center text-slate-500">
            Have an account? <Link className="text-brand-600" to="/login">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
