import fs from 'fs';

const SOURCE_URL = process.env.TOP_TRADER_SOURCE_URL || 'https://tradestie.com/apps/social/groups/';
const POLL_MS = Math.max(15000, Number(process.env.TOP_TRADER_POLL_MS || 60000));
const STARTING_EQUITY = Math.max(1000, Number(process.env.TOP_TRADER_STARTING_EQUITY || 100000));
const NOTIONAL_PER_TRADE = Math.max(100, Number(process.env.TOP_TRADER_NOTIONAL || 5000));
const MAX_OPEN = Math.max(1, Math.min(20, Number(process.env.TOP_TRADER_MAX_OPEN || 10)));
const DATA_PATH = process.env.DATA_DIR ? `${process.env.DATA_DIR}/top-trader-shadow.json` : './top-trader-shadow.json';

const state = loadState();
state.startingEquity ||= STARTING_EQUITY;
state.cash ??= STARTING_EQUITY;
state.open ||= {};
state.closed ||= [];
state.seen ||= {};
state.startedAt ||= new Date().toISOString();
state.sessionDate ||= nyDate();

function loadState() { try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); } catch { return {}; } }
function save() { try { fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2)); } catch {} }
function nyParts() { const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date()); return Object.fromEntries(parts.map(p=>[p.type,p.value])); }
function nyDate(){const p=nyParts(); return `${p.year}-${p.month}-${p.day}`;}
function nyMinutes(){const p=nyParts(); return Number(p.hour)*60+Number(p.minute);}
function isRegularSession(){const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short'}).format(new Date()); if(['Sat','Sun'].includes(weekday)) return false; const m=nyMinutes(); return m>=570&&m<960;}
function extractSignals(html){const text=String(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' '); const out=[]; const re=/\b(Bought|Sold)\s+\$([A-Z]{1,6})\s+@\s+\$([0-9]+(?:\.[0-9]+)?)/g; let m; while((m=re.exec(text))) out.push({action:m[1].toUpperCase(),symbol:m[2],quotedPrice:Number(m[3])}); return out;}
async function sourceSignals(){const r=await fetch(SOURCE_URL,{headers:{'user-agent':'Mozilla/5.0 MomentumFlowShadow/1.0'}}); if(!r.ok) throw new Error(`source HTTP ${r.status}`); return extractSignals(await r.text());}
async function quote(symbol){const u=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`; const r=await fetch(u,{headers:{'user-agent':'Mozilla/5.0 MomentumFlowShadow/1.0'}}); if(!r.ok) throw new Error(`${symbol} quote HTTP ${r.status}`); const j=await r.json(); const q=j?.chart?.result?.[0]; const closes=q?.indicators?.quote?.[0]?.close||[]; for(let i=closes.length-1;i>=0;i--){const px=Number(closes[i]); if(px>0)return px;} const meta=Number(q?.meta?.regularMarketPrice||q?.meta?.previousClose||0); if(meta>0)return meta; throw new Error(`${symbol} no quote`);}
function key(s){return `${s.action}:${s.symbol}:${s.quotedPrice}`;}
async function openSignal(s){if(s.action!=='BOUGHT'||state.open[s.symbol]||Object.keys(state.open).length>=MAX_OPEN)return; let px; try{px=await quote(s.symbol);}catch{px=s.quotedPrice;} if(!(px>0))return; const notional=Math.min(NOTIONAL_PER_TRADE,state.cash); if(notional<100)return; const qty=notional/px; state.cash-=notional; state.open[s.symbol]={symbol:s.symbol,qty,entryPrice:px,sourceQuotedPrice:s.quotedPrice,notional,openedAt:new Date().toISOString()}; console.log(`[top-trader-shadow] OPEN ${s.symbol} qty=${qty.toFixed(6)} entry=${px.toFixed(4)} source=${s.quotedPrice.toFixed(4)}`);}
async function closeSymbol(symbol,reason){const p=state.open[symbol]; if(!p)return; let px; try{px=await quote(symbol);}catch{px=p.entryPrice;} const proceeds=p.qty*px; const pnl=proceeds-p.notional; state.cash+=proceeds; state.closed.push({...p,exitPrice:px,pnl,reason,closedAt:new Date().toISOString()}); delete state.open[symbol]; console.log(`[top-trader-shadow] CLOSE ${symbol} exit=${px.toFixed(4)} pnl=${pnl.toFixed(2)} reason=${reason}`);}
async function mark(){let openValue=0,unrealized=0; for(const p of Object.values(state.open)){let px=p.entryPrice; try{px=await quote(p.symbol);}catch{} openValue+=p.qty*px; unrealized+=p.qty*px-p.notional;} const equity=state.cash+openValue; const realized=state.closed.reduce((a,x)=>a+Number(x.pnl||0),0); const ret=(equity/state.startingEquity-1)*100; console.log(JSON.stringify({event:'TOP_TRADER_SHADOW',at:new Date().toISOString(),source:'Tradestie public live-trade feed',sessionDate:state.sessionDate,startingEquity:state.startingEquity,equity:Number(equity.toFixed(2)),returnPct:Number(ret.toFixed(4)),realizedPnl:Number(realized.toFixed(2)),unrealizedPnl:Number(unrealized.toFixed(2)),openPositions:Object.keys(state.open).length,closedTrades:state.closed.length,orderPlacement:false})); save();}
async function tick(){try{const today=nyDate(); if(state.sessionDate!==today){for(const s of Object.keys(state.open))await closeSymbol(s,'NEW_SESSION'); state.sessionDate=today; state.startingEquity=state.cash; state.closed=[]; state.seen={}; state.feedPrimed=false;} const signals=await sourceSignals(); if(!state.feedPrimed){for(const s of signals)state.seen[key(s)]=new Date().toISOString(); state.feedPrimed=true; console.log(`[top-trader-shadow] primed ${signals.length} existing feed entries; waiting for new real-time signals.`);}else{for(const s of signals.reverse()){const k=key(s); if(state.seen[k])continue; state.seen[k]=new Date().toISOString(); if(s.action==='BOUGHT'&&isRegularSession())await openSignal(s); else if(s.action==='SOLD'&&state.open[s.symbol])await closeSymbol(s.symbol,'SOURCE_SELL');}} if(nyMinutes()>=960&&Object.keys(state.open).length){for(const s of Object.keys(state.open))await closeSymbol(s,'MARKET_CLOSE');} await mark();}catch(e){console.error('[top-trader-shadow] ERROR',e.message);}finally{save(); setTimeout(tick,POLL_MS);}}
console.log(`[top-trader-shadow] START source=${SOURCE_URL} startingEquity=${state.startingEquity} notional=${NOTIONAL_PER_TRADE} maxOpen=${MAX_OPEN} pollMs=${POLL_MS} orderPlacement=false`);
tick();
