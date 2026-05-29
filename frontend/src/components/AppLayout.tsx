import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Link to="/" className="font-semibold text-base sm:text-lg flex items-center gap-2 shrink-0">
            <span className="inline-flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-md bg-brand-600 text-white">📈</span>
            <span className="hidden sm:inline">Portfolio Tracker</span>
            <span className="sm:hidden">Tracker</span>
          </Link>
          <nav className="order-3 sm:order-2 w-full sm:w-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <NavLink to="/" end className={({ isActive }) => isActive ? 'text-brand-600 font-medium' : 'text-slate-600 dark:text-slate-300'}>Dashboard</NavLink>
            <NavLink to="/yearly" className={({ isActive }) => isActive ? 'text-brand-600 font-medium' : 'text-slate-600 dark:text-slate-300'}>Yearly</NavLink>
            <NavLink to="/dividends" className={({ isActive }) => isActive ? 'text-brand-600 font-medium' : 'text-slate-600 dark:text-slate-300'}>Dividends</NavLink>
            <NavLink to="/realized" className={({ isActive }) => isActive ? 'text-brand-600 font-medium' : 'text-slate-600 dark:text-slate-300'}>Realized</NavLink>
            <NavLink to="/transactions" className={({ isActive }) => isActive ? 'text-brand-600 font-medium' : 'text-slate-600 dark:text-slate-300'}>Transactions</NavLink>
            <NavLink to="/import" className={({ isActive }) => isActive ? 'text-brand-600 font-medium' : 'text-slate-600 dark:text-slate-300'}>Import</NavLink>
          </nav>
          <div className="order-2 sm:order-3 flex items-center gap-2 sm:gap-3 ml-auto sm:ml-0">
            <span className="hidden sm:inline text-sm text-slate-500 truncate max-w-[180px]">{user?.displayName ?? user?.email}</span>
            <button
              className="btn-secondary text-xs sm:text-sm px-2 sm:px-4 py-1.5 sm:py-2"
              onClick={() => { logout(); navigate('/login'); }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <Outlet />
      </main>
      <footer className="text-center py-4 text-xs text-slate-500 px-2">
        Portfolio Tracker · S&amp;P 500 benchmark via Yahoo Finance
      </footer>
    </div>
  );
}
