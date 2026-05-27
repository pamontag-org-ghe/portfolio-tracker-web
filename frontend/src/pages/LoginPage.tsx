import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiErrorMessage } from '../api/client';
import BrandLogo from '../components/BrandLogo';

export default function LoginPage() {
  const { login, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  if (user) return <Navigate to="/" replace />;

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
              Track your investments, yields and benchmark performance in one place.
            </p>
          </div>
        </div>
        <form
          className="card space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSubmitting(true);
            setError(null);
            try { await login(email, password); }
            catch (err) { setError(apiErrorMessage(err)); }
            finally { setSubmitting(false); }
          }}
        >
          <h2 className="text-xl font-semibold">Sign in</h2>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <button className="btn-primary w-full" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-sm text-center text-slate-500">
            No account? <Link className="text-brand-600" to="/register">Register</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
