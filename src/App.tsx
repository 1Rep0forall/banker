import { NavLink, Route, Routes } from 'react-router-dom';
import { useData } from './useData';
import Dashboard from './pages/Dashboard';
import ImportPage from './pages/Import';
import Accounts from './pages/Accounts';
import AccountDetail from './pages/AccountDetail';
import Recurring from './pages/Recurring';
import Transactions from './pages/Transactions';
import SettingsPage from './pages/Settings';

const NAV = [
  { to: '/', label: 'Today', icon: '☀️' },
  { to: '/import', label: 'Import', icon: '📥' },
  { to: '/accounts', label: 'Accounts', icon: '🏦' },
  { to: '/recurring', label: 'Recurring', icon: '🔁' },
  { to: '/transactions', label: 'Transactions', icon: '🧾' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function App() {
  const data = useData();
  const urgent = data.alerts.filter((a) => a.severity === 'critical' || a.severity === 'warning').length;
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">
          <span className="brand-mark" aria-hidden>$</span> Banker
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav-link">
            <span aria-hidden>{n.icon}</span>
            <span className="nav-label">{n.label}</span>
            {n.to === '/' && urgent > 0 && <span className="badge" aria-label={`${urgent} items need attention`}>{urgent}</span>}
          </NavLink>
        ))}
        <p className="nav-foot">🔒 Your data stays in this browser.</p>
      </nav>
      <main className="main">
        {data.loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard data={data} />} />
            <Route path="/import" element={<ImportPage data={data} />} />
            <Route path="/accounts" element={<Accounts data={data} />} />
            <Route path="/accounts/:id" element={<AccountDetail data={data} />} />
            <Route path="/recurring" element={<Recurring data={data} />} />
            <Route path="/transactions" element={<Transactions data={data} />} />
            <Route path="/settings" element={<SettingsPage data={data} />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
