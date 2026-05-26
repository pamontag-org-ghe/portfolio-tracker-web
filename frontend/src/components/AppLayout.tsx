import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <Link to="/" className="font-semibold text-lg flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white">📈</span>
            Portfolio Tracker
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4 text-sm">
            <NavLink to="/" end className={({ isActive }) => isActive ? 'text-brand-600 font-medium' : 'text-slate-600 dark:text-slate-300'}>Dashboard</NavLink>
            <NavLink to="/yearly" className={({ isActive }) => isActive ? 'text-brand-600 font-medium' : 'text-slate-600 dark:text-slate-300'}>Yearly</NavLink>
            <NavLink to="/transactions" className={({ isActive }) => isActive ? 'text-brand-600 font-medium' : 'text-slate-600 dark:text-slate-300'}>Transactions</NavLink>
            <NavLink to="/import" className={({ isActive }) => isActive ? 'text-brand-600 font-medium' : 'text-slate-600 dark:text-slate-300'}>Import</NavLink>
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-sm text-slate-500">{user?.displayName ?? user?.email}</span>
            <button
              className="btn-secondary text-sm"
              onClick={() => { logout(); navigate('/login'); }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
      <footer className="text-center py-4 text-xs text-slate-500">
        Portfolio Tracker · S&amp;P 500 benchmark via Yahoo Finance
      </footer>
    </div>
  );
}
