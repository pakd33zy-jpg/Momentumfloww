import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Dashboard', icon: '◈' },
  { to: '/v26', label: 'V26 Research', icon: 'V' },
  { to: '/sessions', label: 'Sessions', icon: '≋' },
  { to: '/chat', label: 'Assistant', icon: '▷' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
  { to: '/connections', label: 'Connections', icon: '🔐' },
  { to: '/funding', label: 'Funding', icon: '$' },
];
function Navigation({ mobile = false }) {
  return <nav className={mobile ? 'app-mobile-nav' : 'app-desktop-nav'}>
    {TABS.map((tab) => <NavLink key={tab.to} to={tab.to} end={tab.to === '/'} className={({ isActive }) => isActive ? 'app-nav-link active' : 'app-nav-link'}>
      <span className="app-nav-icon">{tab.icon}</span><span>{tab.label}</span>
    </NavLink>)}
  </nav>;
}
export default function AppLayout() {
  return <div className="app-shell">
    <header className="app-header"><span className="display app-brand">MomentumFlow</span><span className="app-header-caption">MULTI-MARKET TRADING WORKSPACE</span></header>
    <div className="app-layout-content">
      <Navigation />
      <main className="app-main"><Outlet /></main>
    </div>
    <Navigation mobile />
  </div>;
}
