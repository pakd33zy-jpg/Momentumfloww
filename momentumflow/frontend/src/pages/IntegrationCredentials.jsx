import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
const PROVIDERS = [
  { id:'crypto', title:'Crypto exchange', note:'Use trade-only API permissions. Disable withdrawals.', fields:[['label','Exchange / connection name','text'],['apiKey','API key','password'],['apiSecret','API secret','password'],['passphrase','API passphrase (if required)','password']] },
  { id:'forex', title:'Forex / gold broker', note:'Use a demo account first. Broker order routing is a separate implementation step.', fields:[['label','Broker / connection name','text'],['accountId','Account ID','password'],['apiKey','API key / client ID','password'],['apiSecret','API secret / token','password'],['password','Broker password (only if API requires it)','password']] },
  { id:'ninjatrader', title:'NinjaTrader', note:'Connection credentials only; this form does not enable order routing.', fields:[['label','Connection name','text'],['username','Username','password'],['password','Password / access token','password'],['apiKey','API key (if applicable)','password'],['apiSecret','API secret (if applicable)','password']] },
  { id:'polymarket', title:'Polymarket', note:'Wallet/API credentials are stored encrypted. Transfer and withdrawal features are not implemented.', fields:[['label','Wallet / connection label','text'],['apiKey','API key','password'],['apiSecret','API secret','password'],['passphrase','API passphrase','password']] },
];
export default function IntegrationCredentials() {
 const [status,setStatus]=useState({}); const [values,setValues]=useState({}); const [busy,setBusy]=useState(''); const [message,setMessage]=useState(''); const [token,setToken]=useState('');
 const refresh=async()=>{if(!token)return;try{setStatus(await api.getIntegrations(token));}catch(e){setMessage(e.message);}};
 useEffect(()=>{refresh();},[token]);
 const change=(p,f,v)=>setValues(old=>({...old,[p]:{...(old[p]||{}),[f]:v}}));
 const save=async p=>{setBusy(p);setMessage('');try{await api.saveIntegration(p,values[p]||{},token);setValues(old=>({...old,[p]:{}}));await refresh();setMessage('Credentials saved.');}catch(e){setMessage(e.message);}finally{setBusy('');}};
 const remove=async p=>{if(!window.confirm('Remove saved credentials for this connection?'))return;setBusy(p);try{await api.deleteIntegration(p,token);await refresh();setMessage('Credentials removed.');}catch(e){setMessage(e.message);}finally{setBusy('');}};
 return <div style={{display:'grid',gap:12}}>
  <div style={hint}>Enter the settings access token configured by the site administrator in Render. This extra gate is required because the app does not yet have full user sign-in. Provider secrets are encrypted server-side and never returned in readable form. Never enter a wallet seed phrase or private key here.</div><label style={field}><span>Integration settings access token</span><input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} placeholder="INTEGRATION_SETTINGS_TOKEN" /></label>
  {PROVIDERS.map(p=>{const s=status[p.id]||{};return <section key={p.id} style={card}>
   <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center'}}><strong>{p.title}</strong><span style={{color:s.configured?'#4ade80':'var(--text-dim)',fontSize:11}}>{s.configured?'CREDENTIALS SAVED':'NOT CONFIGURED'}</span></div>
   <p style={note}>{p.note}</p>
   {p.fields.map(([f,label,type])=><label key={f} style={field}><span>{label}{s.fields?.[f]? ' — saved as '+s.fields[f].masked:''}</span><input type={type} autoComplete="off" value={values[p.id]?.[f]||''} placeholder={s.fields?.[f]?'Leave blank to keep saved value':'Enter value'} onChange={e=>change(p.id,f,e.target.value)}/></label>)}
   <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}><button disabled={busy===p.id} onClick={()=>save(p.id)} style={primary}>{busy===p.id?'Saving…':'Save credentials'}</button>{s.configured&&<button disabled={busy===p.id} onClick={()=>remove(p.id)} style={secondary}>Remove</button>}</div>
  </section>})}
  {message&&<div role="status" style={hint}>{message}</div>}
 </div>;
}
const card={background:'var(--bg-raised)',border:'1px solid var(--line)',borderRadius:12,padding:14};
const hint={color:'var(--text-secondary)',fontSize:12,lineHeight:1.5,padding:12,border:'1px solid var(--line)',borderRadius:10};
const note={color:'var(--text-secondary)',fontSize:12,lineHeight:1.45,margin:'8px 0 12px'};
const field={display:'grid',gap:5,marginTop:9,color:'var(--text-secondary)',fontSize:12};
const primary={background:'var(--accent)',color:'#07111f',border:0,borderRadius:8,padding:'9px 12px',fontWeight:700};
const secondary={background:'transparent',color:'var(--text-secondary)',border:'1px solid var(--line)',borderRadius:8,padding:'9px 12px'};
