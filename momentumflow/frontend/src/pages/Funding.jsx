import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Funding() {
  const [accounts, setAccounts] = useState({paper:null,live:null});
  useEffect(() => { api.getBrokerAccounts().then(setAccounts).catch(() => {}); }, []);
  const connected = accounts?.paper?.connected || accounts?.live?.connected;

  return (
    <div style={{maxWidth:850,margin:'0 auto'}}>
      <h2>Broker & Funding</h2>
      <div style={card}>
        <strong>{connected ? 'Broker connection found' : 'No broker connected'}</strong>
        <p style={muted}>
          MomentumFlow does not collect SSNs, bank passwords, routing numbers, or identity documents.
          Account opening and funding stay with the broker.
        </p>
        {!connected && (
          <a href="https://alpaca.markets/" target="_blank" rel="noreferrer" style={primary}>
            Open an Alpaca account
          </a>
        )}
        <a href="/settings" style={secondary}>Connect existing broker account</a>
      </div>

      <div style={card}>
        <strong>Deposits & withdrawals</strong>
        <p style={muted}>
          For safety, cash transfers are managed in the broker portal. MomentumFlow can show broker balances,
          but it does not store bank credentials or initiate bank transfers from this page.
        </p>
        <a href="https://app.alpaca.markets/" target="_blank" rel="noreferrer" style={primary}>
          Manage funding in Alpaca
        </a>
      </div>

      <div style={card}>
        <strong>Connection status</strong>
        <div style={line}>Paper: {accounts?.paper?.connected ? 'Connected' : 'Not connected'}</div>
        <div style={line}>Live: {accounts?.live?.connected ? 'Connected' : 'Not connected'}</div>
      </div>
    </div>
  );
}
const card={background:'#1e2139',border:'1px solid #2a2e4a',borderRadius:8,padding:18,marginBottom:15};
const muted={color:'#94a3b8',fontSize:12,lineHeight:1.5};
const primary={display:'inline-block',padding:'10px 14px',background:'#2563eb',color:'#fff',textDecoration:'none',borderRadius:6,marginRight:8,marginTop:8};
const secondary={...primary,background:'transparent',border:'1px solid #475569'};
const line={color:'#cbd5e1',fontSize:12,marginTop:8};
