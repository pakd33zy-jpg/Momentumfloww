import React from 'react';
import { Routes, Route } from 'react-router-dom';
import AppLayout from './components/AppLayout.jsx';
import ScrollToTop from './components/ScrollToTop.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Sessions from './pages/Sessions.jsx';
import Chat from './pages/Chat.jsx';
import Settings from './pages/Settings.jsx';
import V26 from './pages/V26.jsx';
import SymbolDetail from './pages/SymbolDetail.jsx';
import Funding from './pages/Funding.jsx';

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/v26" element={<V26 />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/symbol/:symbol" element={<SymbolDetail />} />
          <Route path="/funding" element={<Funding />} />
        </Route>
      </Routes>
    </>
  );
}
