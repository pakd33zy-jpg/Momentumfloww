import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Dashboard', icon: '◈' },
  { to: '/v26', label: 'V26', icon: 'V' },
  { to: '/sessions', label: 'Sessions', icon: '≋' },
  { to: '/chat', label: 'Chat', icon: '▷' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
  { to: '/funding', label: 'Funding', icon: '$' },
];

export default function AppLayout() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', paddingBottom: 72 }}>
      <header style={headerStyle}>
        <span className="display" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
          MomentumFlow
        </span>
      </header>
      <main style={{ flex: 1, padding: '16px 16px 24px' }}>
        <Outlet />
      </main>
      <nav style={navStyle}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            style={({ isActive }) => ({
              ...tabStyle,
              color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
            })}
          >
            <span style={{ fontSize: 18 }}>{tab.icon}</span>
            <span style={{ fontSize: 11, marginTop: 2 }}>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

const headerStyle = {
  padding: '16px',
  borderBottom: '1px solid var(--line)',
  position: 'sticky',
  top: 0,
  background: 'var(--bg)',
  zIndex: 10,
};

const navStyle = {
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: 0,
  display: 'flex',
  background: 'var(--bg-raised)',
  borderTop: '1px solid var(--line)',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
};

const tabStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px 0 8px',
  textDecoration: 'none',
};
