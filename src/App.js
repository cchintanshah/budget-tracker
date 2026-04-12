import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area, Line, ComposedChart
} from 'recharts';
import * as XLSX from 'xlsx';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions } from './firebase';
import {
  ShoppingCart, Utensils, Car, Smartphone, Bus, Lightbulb, Package, Home, Send,
  LayoutDashboard, Wallet, Zap, ArrowDownToLine, Settings as SettingsIcon, Banknote, Coins, TrendingUp, TrendingDown,
  Lock, Unlock, Edit, Plus, ClipboardList, CreditCard, Droplet, Flame, Globe, Building2, Save, Trash2,
  Check, X, Database, Cloud, Download
} from 'lucide-react';
import './App.css';

/* ═══════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════ */

const CATEGORIES = [
  { name: 'Grocery', color: '#10B981', icon: <ShoppingCart size={18} /> },
  { name: 'Eat Outside', color: '#F59E0B', icon: <Utensils size={18} /> },
  { name: 'Car', color: '#EF4444', icon: <Car size={18} /> },
  { name: 'Mobile', color: '#8B5CF6', icon: <Smartphone size={18} /> },
  { name: 'Presto - Commute', color: '#06B6D4', icon: <Bus size={18} /> },
  { name: 'Utility', color: '#F97316', icon: <Lightbulb size={18} /> },
  { name: 'Miscellaneous', color: '#EC4899', icon: <Package size={18} /> },
  { name: 'Mortgage', color: '#6366F1', icon: <Home size={18} /> },
  { name: 'Remittance to India', color: '#14B8A6', icon: <Send size={18} /> },
];

const TENANT_CAP = 200;
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CUR_YEAR = new Date().getFullYear();
const CUR_MONTH = new Date().getMonth();
const SUPPORTS_FS = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const fmt = (n) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);
const mkKey = (y, m) => `${MON_SHORT[m]} ${y}`;
const parseKey = (key) => {
  const p = key.split(' ');
  return { year: +p[1], month: MON_SHORT.indexOf(p[0]) };
};
const dateDefault = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}-01`;

/* ═══════════════════════════════════════════
   UTILITY SPLIT
   ═══════════════════════════════════════════ */

const calcSplit = (u) => {
  if (!u) return null;
  const w = +u.water || 0, eb = +u.elecBase || 0, em = +u.elecMain || 0, g = +u.gas || 0, i = +u.internet || 0;
  const total = w + eb + em + g + i;
  const tW = w * 0.4, tG = g * 0.4, tE = eb;
  const tCalc = tW + tG + tE;
  const tOverage = Math.max(0, tCalc - TENANT_CAP);
  return {
    total,
    tenant: { water: tW, gas: tG, elec: tE, calc: tCalc, overage: tOverage, actual: tOverage, isOver: tCalc > TENANT_CAP },
    landlord: { totalBill: total, tenantReimbursement: tOverage, netCost: total - tOverage },
  };
};

/* ═══════════════════════════════════════════
   EXCEL I/O
   ═══════════════════════════════════════════ */

function excelDateToStr(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  return String(val);
}

function buildWorkbook(allData) {
  const wb = XLSX.utils.book_new();
  const keys = Object.keys(allData).sort((a, b) => {
    const pa = parseKey(a), pb = parseKey(b);
    return (pa.year - pb.year) || (pa.month - pb.month);
  });

  for (const key of keys) {
    const { expenses = [], incomes = [], utilities = {} } = allData[key] || {};
    const rows = [];

    // ── EXPENSES ──
    rows.push(['=== EXPENSES ===', '', '', '']);
    rows.push(['Date', 'Description', 'Category', 'Amount']);
    expenses.forEach(e => rows.push([e.date, e.description, e.category, +(+e.cost || 0).toFixed(2)]));
    if (!expenses.length) rows.push(['', 'No expenses this month', '', '']);
    rows.push([]);

    // ── INCOME ──
    rows.push(['=== INCOME ===', '', '']);
    rows.push(['Date', 'Description', 'Amount']);
    incomes.forEach(i => rows.push([i.date, i.description, +(+i.amount || 0).toFixed(2)]));
    if (!incomes.length) rows.push(['', 'No income this month', '']);
    rows.push([]);

    // ── UTILITIES ──
    rows.push(['=== UTILITIES ===', '']);
    rows.push(['Item', 'Amount']);
    rows.push(['Water (Full House)', +(+utilities.water || 0).toFixed(2)]);
    rows.push(['Electricity (Basement)', +(+utilities.elecBase || 0).toFixed(2)]);
    rows.push(['Electricity (Main)', +(+utilities.elecMain || 0).toFixed(2)]);
    rows.push(['Gas (Full House)', +(+utilities.gas || 0).toFixed(2)]);
    rows.push(['Internet', +(+utilities.internet || 0).toFixed(2)]);
    rows.push([]);

    // ── SPLIT SUMMARY ──
    const sp = calcSplit(utilities);
    if (sp && sp.total > 0) {
      rows.push(['=== SPLIT SUMMARY ===', '']);
      rows.push(['Metric', 'Amount']);
      rows.push(['Total Utility Bill', sp.total]);
      rows.push(['Tenant Calculated Share', sp.tenant.calc]);
      rows.push([`Cap ($${TENANT_CAP})`, TENANT_CAP]);
      rows.push(['Tenant Pays (Overage)', sp.tenant.actual]);
      rows.push(['Landlord Pays (Full Bill)', sp.landlord.totalBill]);
      rows.push(['Landlord Net Cost', sp.landlord.netCost]);
      rows.push([]);
    }

    // ── MONTH SUMMARY ──
    const totExp = expenses.reduce((s, e) => s + (+e.cost || 0), 0);
    const totInc = incomes.reduce((s, i) => s + (+i.amount || 0), 0);
    const tenantP = sp?.tenant.actual || 0;
    rows.push(['=== MONTH SUMMARY ===', '']);
    rows.push(['Metric', 'Amount']);
    rows.push(['Total Income', totInc]);
    rows.push(['Total Expenses', totExp]);
    rows.push(['Tenant Utility Overage', tenantP]);
    rows.push(['Total Outflow', totExp + tenantP]);
    rows.push(['Net Savings', totInc - totExp - tenantP]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 28 }, { wch: 32 }, { wch: 22 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, key);
  }

  if (keys.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([['BudgetPro', 'No data yet. Add expenses in the app.']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Info');
  }
  return wb;
}

function parseWorkbook(wb) {
  const allData = {};
  for (const name of wb.SheetNames) {
    const pk = parseKey(name);
    if (isNaN(pk.year) || pk.month < 0) continue;

    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    let mode = null;
    let headerSkip = false;
    const result = { expenses: [], incomes: [], utilities: { water: '', elecBase: '', elecMain: '', gas: '', internet: '' } };

    for (const row of rows) {
      const c0 = String(row?.[0] || '').trim();

      if (c0 === '=== EXPENSES ===') { mode = 'exp'; headerSkip = false; continue; }
      if (c0 === '=== INCOME ===') { mode = 'inc'; headerSkip = false; continue; }
      if (c0 === '=== UTILITIES ===') { mode = 'util'; headerSkip = false; continue; }
      if (c0 === '=== SPLIT SUMMARY ===' || c0 === '=== MONTH SUMMARY ===') { mode = null; continue; }

      if (mode && !headerSkip) { headerSkip = true; continue; }

      if (!row || row.every(c => c === '' || c == null)) { mode = null; continue; }

      if (mode === 'exp' && c0 && !c0.startsWith('No ')) {
        result.expenses.push({ id: uid(), date: excelDateToStr(row[0]), description: String(row[1] || ''), category: String(row[2] || 'Miscellaneous'), cost: String(row[3] || '0') });
      }
      if (mode === 'inc' && c0 && !c0.startsWith('No ')) {
        result.incomes.push({ id: uid(), date: excelDateToStr(row[0]), description: String(row[1] || ''), amount: String(row[2] || '0') });
      }
      if (mode === 'util') {
        const item = c0.toLowerCase();
        const val = String(row[1] || '');
        if (item.includes('water')) result.utilities.water = val;
        else if (item.includes('basement')) result.utilities.elecBase = val;
        else if (item.includes('main')) result.utilities.elecMain = val;
        else if (item.includes('gas')) result.utilities.gas = val;
        else if (item.includes('internet')) result.utilities.internet = val;
      }
    }
    allData[name] = result;
  }
  return allData;
}

async function writeToHandle(handle, allData) {
  const wb = buildWorkbook(allData);
  const wbuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    await handle.requestPermission({ mode: 'readwrite' });
  }
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function downloadWorkbook(allData) {
  const wb = buildWorkbook(allData);
  XLSX.writeFile(wb, 'BudgetPro.xlsx');
}

/* ═══════════════════════════════════════════
   APP COMPONENT
   ═══════════════════════════════════════════ */

export default function App() {
  const [allData, setAllData] = useState(() => load('bpro_data', {}));
  const [year, setYear] = useState(CUR_YEAR);
  const [monthIdx, setMonthIdx] = useState(CUR_MONTH);
  const [page, setPage] = useState('dashboard');
  const [cloudStatus, setCloudStatus] = useState('idle');
  const [sbOpen, setSbOpen] = useState(window.innerWidth > 768);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  // Check Firebase Auth state for secure persistent sessions
  useEffect(() => {
    if (!auth) {
      // Fallback if not configured
      setIsUnlocked(sessionStorage.getItem('bpro_unlocked') === 'true');
      setAuthChecking(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // Since we verify the key before calling signInAnonymously, 
      // if a user object exists, they have already been verified.
      if (user) {
        setIsUnlocked(true);
      } else {
        setIsUnlocked(false);
      }
      setAuthChecking(false);
    });
    return unsubscribe;
  }, []);

  const cloudTimerRef = useRef(null);
  const firstRender = useRef(true);
  const dataLoaded = useRef(false);

  const key = mkKey(year, monthIdx);
  const monthData = useMemo(() => allData[key] || { expenses: [], incomes: [], utilities: {} }, [allData, key]);
  const split = calcSplit(monthData.utilities);
  const tenantP = split?.tenant.actual || 0;
  const totExp = monthData.expenses.reduce((s, e) => s + (+e.cost || 0), 0);
  const totInc = monthData.incomes.reduce((s, i) => s + (+i.amount || 0), 0);

  /* ── years for dropdown — ever-growing list ── */
  const years = useMemo(() => {
    // Collect all years that have data
    const dataYears = Object.keys(allData)
      .map(k => parseKey(k).year)
      .filter(y => !isNaN(y));

    // Find the earliest year (either from data or last year)
    const minYear = Math.min(CUR_YEAR - 1, ...dataYears);

    // The max year should be:
    // - At least current year + 1
    // - Or selected year + 1 (so next year is always visible)
    // - Or highest year in data + 1
    const maxYear = Math.max(
      CUR_YEAR + 1,
      year + 1,           // ← THIS makes it ever-growing
      ...dataYears.map(y => y + 1)
    );

    // Generate continuous range from min to max
    const result = [];
    for (let y = minYear; y <= maxYear; y++) {
      result.push(y);
    }
    return result;
  }, [allData, year]);

  /* ── all month keys across data ── */
  const allMonthKeys = useMemo(() => {
    const s = new Set([key]);
    Object.keys(allData).forEach(k => s.add(k));
    return [...s].sort((a, b) => { const pa = parseKey(a), pb = parseKey(b); return (pa.year - pb.year) || (pa.month - pb.month); });
  }, [allData, key]);

  /* ── Initial Fetch from Firebase ── */
  useEffect(() => {
    async function loadCloudData() {
      // ONLY pull from cloud once we have unlocked/authenticated!
      if (!isUnlocked) return;

      if (!db) {
        setCloudStatus('disconnected');
        dataLoaded.current = true;
        return;
      }
      try {
        setCloudStatus('loading');
        const docSnap = await getDoc(doc(db, 'budget', 'mainData'));
        
        if (docSnap.exists() && Object.keys(docSnap.data().allData || {}).length > 0) {
          // Cloud has data: Use Cloud as source of truth
          const cloudData = docSnap.data().allData;
          setAllData(cloudData);
          save('bpro_data', cloudData);
        } else {
          // Cloud is empty. Do we have local legacy data?
          if (Object.keys(allData).length > 0) {
            console.log("Cloud empty. Pushing legacy local data to Firebase.");
            await setDoc(doc(db, 'budget', 'mainData'), { allData });
          }
        }
        setCloudStatus('synced');
      } catch (e) {
        console.error('Firebase load error:', e);
        setCloudStatus('error');
      } finally {
        dataLoaded.current = true;
      }
    }
    loadCloudData();
  }, [isUnlocked]);

  /* ── auto-save to localStorage + file + cloud ── */
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (!dataLoaded.current) return; // don't overwrite if we haven't fetched from cloud yet
    
    // 1. Local Storage Backup
    save('bpro_data', allData);

    // 2. Cloud Auto-Sync
    if (db) {
      if (cloudTimerRef.current) clearTimeout(cloudTimerRef.current);
      setCloudStatus('syncing');
      cloudTimerRef.current = setTimeout(async () => {
        try {
          await setDoc(doc(db, 'budget', 'mainData'), { allData });
          setCloudStatus('synced');
        } catch (e) {
          console.error('Firebase save error:', e);
          setCloudStatus('error');
        }
      }, 1000);
    }
  }, [allData]);

  /* ── 13th reminder ── */
  useEffect(() => {
    const check = () => {
      const today = new Date();
      if (today.getDate() === 13) {
        const nk = `bpro_notif_${CUR_YEAR}_${CUR_MONTH}`;
        if (!localStorage.getItem(nk)) {
          if ('Notification' in window && Notification.permission === 'granted')
            new Notification('BudgetPro 💰', { body: 'Add your utility costs for this month!' });
          localStorage.setItem(nk, '1');
        }
      }
    };
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    check();
    const id = setInterval(check, 3600000);
    return () => clearInterval(id);
  }, []);

  /* ── data updater ── */
  const updateMonth = useCallback((updater) => {
    const k = mkKey(year, monthIdx);
    setAllData(prev => {
      const cur = prev[k] || { expenses: [], incomes: [], utilities: {} };
      return { ...prev, [k]: updater(cur) };
    });
  }, [year, monthIdx]);

  /* CRUD */
  const addExp = (e) => updateMonth(d => ({ ...d, expenses: [...d.expenses, { ...e, id: uid() }] }));
  const delExp = (id) => updateMonth(d => ({ ...d, expenses: d.expenses.filter(e => e.id !== id) }));
  const updExp = (id, u) => updateMonth(d => ({ ...d, expenses: d.expenses.map(e => e.id === id ? { ...e, ...u } : e) }));
  const addInc = (i) => updateMonth(d => ({ ...d, incomes: [...d.incomes, { ...i, id: uid() }] }));
  const delInc = (id) => updateMonth(d => ({ ...d, incomes: d.incomes.filter(i => i.id !== id) }));
  const saveUtil = (u) => updateMonth(d => ({ ...d, utilities: u }));



  const handleDownload = () => downloadWorkbook(allData);

  const nav = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { id: 'budget', label: 'Budget', icon: <Wallet size={20} /> },
    { id: 'utilities', label: 'Utilities', icon: <Zap size={20} /> },
    { id: 'income', label: 'Income', icon: <ArrowDownToLine size={20} /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon size={20} /> },
  ];

  const isThe13 = new Date().getDate() === 13;

  return (
    <div className="app">
      {authChecking && (
        <div className="lock-screen"><div className="lock-card"><h2>Loading secure environment...</h2></div></div>
      )}
      {!isUnlocked && !authChecking && (
        <LockScreen onUnlock={() => {
          sessionStorage.setItem('bpro_unlocked', 'true');
          setIsUnlocked(true);
        }} />
      )}
      {isUnlocked && !authChecking && (
        <>
      {/* ── SIDEBAR ── */}
      <aside className={`sidebar ${sbOpen ? 'open' : ''}`}>
        <div className="sb-head">
          {sbOpen && <h2>Budget Tracker</h2>}
          <button className="sb-toggle" onClick={() => setSbOpen(!sbOpen)}>{sbOpen ? '✕' : '☰'}</button>
        </div>
        <nav className="sb-nav">
          {nav.map(n => (
            <button key={n.id} className={`sb-item ${page === n.id ? 'active' : ''}`}
              onClick={() => { setPage(n.id); if (window.innerWidth < 769) setSbOpen(false); }}>
              <span className="sb-icon">{n.icon}</span>
              {sbOpen && <span>{n.label}</span>}
            </button>
          ))}
        </nav>
        {sbOpen && (
          <div className="sb-file-info" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className={`file-dot ${db && cloudStatus !== 'error' && cloudStatus !== 'disconnected' ? 'green' : 'gray'}`} />
              <span>{db ? 'Cloud Database Connected' : 'Local Mode Only'}</span>
            </div>
          </div>
        )}
      </aside>

      {sbOpen && window.innerWidth < 769 && <div className="overlay" onClick={() => setSbOpen(false)} />}

      {/* ── MAIN ── */}
      <main className="main">
        {/* ── TOP BAR ── */}
        <header className="topbar">
          <div className="tb-left">
            <button className="mob-menu" onClick={() => setSbOpen(true)}>☰</button>
            <h1>{nav.find(n => n.id === page)?.icon} {nav.find(n => n.id === page)?.label}</h1>
          </div>
          <div className="tb-right">
            {/* Year / Month selectors */}
            <select value={year} onChange={e => setYear(+e.target.value)} className="ym-sel">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={monthIdx} onChange={e => setMonthIdx(+e.target.value)} className="ym-sel month-sel-dd">
              {MON_FULL.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>

            {/* Export button */}
            <button className="btn btn-file" onClick={handleDownload} title="Export Data to Excel" style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <Download size={18} /> Export To Excel
            </button>
          </div>
        </header>

        {/* ── File Connection Banner ── */}
        {db && cloudStatus === 'disconnected' && (
          <div className="file-banner" style={{ background: 'rgba(239, 68, 68, 0.1)', borderBottom: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <span>⚠️</span>
            <div>
              <strong style={{ color: '#F87171' }}>Firebase Database Configuration Missing</strong>
              <p>Please edit `src/firebase.js` and paste your Firebase Web App configuration keys to enable permanent cloud storage.</p>
            </div>
          </div>
        )}




        <div className="content">
          {page === 'dashboard' && (
            <Dashboard allData={allData} monthData={monthData} split={split} tenantP={tenantP}
              totExp={totExp} totInc={totInc} year={year} monthIdx={monthIdx}
              allMonthKeys={allMonthKeys} years={years} />
          )}
          {page === 'budget' && (
            <BudgetTracker expenses={monthData.expenses} addExp={addExp} delExp={delExp} updExp={updExp}
              year={year} monthIdx={monthIdx} totExp={totExp} tenantP={tenantP} />
          )}
          {page === 'utilities' && (
            <UtilityManager util={monthData.utilities} save={saveUtil} sheetKey={key} />
          )}
          {page === 'income' && (
            <IncomeManager incomes={monthData.incomes} addInc={addInc} delInc={delInc}
              year={year} monthIdx={monthIdx} totInc={totInc} />
          )}
          {page === 'settings' && (
            <Settings allData={allData} setAllData={setAllData}
              cloudStatus={cloudStatus} db={db}
              handleDownload={handleDownload} />
          )}
        </div>
      </main>
      </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   LOCK SCREEN
   ═══════════════════════════════════════════ */

const APP_ACCESS_KEY = 'asdfg@8016';

function LockScreen({ onUnlock }) {
  const [inputKey, setInputKey] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputKey.trim()) return;

    setIsLoading(true);
    setError('');

    try {
      if (inputKey === APP_ACCESS_KEY) {
        // Correct key! Log into Firebase anonymously to gain database access rules
        if (auth) {
          await signInAnonymously(auth);
        }
        
        sessionStorage.setItem('bpro_unlocked', 'true');
        onUnlock();
      } else {
        showError('Incorrect access key. Please try again.');
      }
    } catch (err) {
      console.error("LockScreen Login Error:", err);
      if (err.code === 'auth/operation-not-allowed') {
        showError('Please enable "Anonymous" provider in Firebase Console > Authentication.');
      } else {
        showError('Login failed. Please check connection.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const showError = (msg) => {
    setError(msg);
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
    setInputKey('');
  };

  return (
    <div className="lock-screen">
      <div className={`lock-card ${shaking ? 'shake' : ''}`}>
        <div className="lock-icon"><Lock size={48} /></div>
        <h2>Budget Tracker</h2>
        <p>Enter your access key to continue</p>
        <form onSubmit={handleSubmit} className="lock-form">
          <input
            type="password"
            placeholder="Access Key"
            value={inputKey}
            onChange={e => { setInputKey(e.target.value); setError(''); }}
            autoFocus
            className="lock-input"
          />
          {error && <span className="lock-error">{error}</span>}
          <button type="submit" className="btn btn-pri lock-btn" disabled={isLoading} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            {isLoading ? 'Verifying...' : <><Unlock size={18} /> Unlock</>}
          </button>
        </form>
        <p className="lock-hint">This app is protected. Unauthorized access is prohibited.</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════ */

function Dashboard({ allData, monthData, split, tenantP, totExp, totInc, year, monthIdx, allMonthKeys, years }) {
  const savings = totInc - totExp - tenantP;
  const totalOutflow = totExp + tenantP;
  const key = mkKey(year, monthIdx);

  // Read saved layout from localStorage, fallback to default charts
  const defaultOrder = ['cat-pie', 'top-exp', 'cat-bars', 'cat-month', 'inc-exp', 'sav-trend', 'util-trend', 'yearly-trend'];
  const [chartOrder, setChartOrder] = useState(() => {
    try {
      const saved = localStorage.getItem('bpro_chart_order');
      if (saved) return JSON.parse(saved);
    } catch {}
    return defaultOrder;
  });

  // Local state for the breakdown widget's independent month/year selection
  const [breakdownYear, setBreakdownYear] = useState(year);
  const [breakdownMonth, setBreakdownMonth] = useState(monthIdx);
  
  // Update local defaults if main dashboard month/year changes
  useEffect(() => {
    setBreakdownYear(year);
    setBreakdownMonth(monthIdx);
  }, [year, monthIdx]);

  const localKey = mkKey(breakdownYear, breakdownMonth);
  const localData = allData[localKey] || { expenses: [], incomes: [], utilities: {} };
  const localSplit = calcSplit(localData.utilities);
  const localTenantP = localSplit?.tenant.actual || 0;

  const localCatData = useMemo(() => {
    const m = {};
    localData.expenses.forEach(e => { m[e.category] = (m[e.category] || 0) + (+e.cost || 0); });
    const r = CATEGORIES.map(c => ({ name: c.name, value: m[c.name] || 0, color: c.color })).filter(c => c.value > 0);
    if (localTenantP > 0) r.push({ name: 'Tenant Overage', value: localTenantP, color: '#DC2626' });
    return r;
  }, [localData.expenses, localTenantP]);

  const [draggedIdx, setDraggedIdx] = useState(null);

  const handleDragStart = (idx) => setDraggedIdx(idx);
  const handleDragEnter = (e, idx) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    const newOrder = [...chartOrder];
    const item = newOrder[draggedIdx];
    newOrder.splice(draggedIdx, 1);
    newOrder.splice(idx, 0, item);
    setDraggedIdx(idx);
    setChartOrder(newOrder);
  };
  const handleDragEnd = () => {
    setDraggedIdx(null);
    localStorage.setItem('bpro_chart_order', JSON.stringify(chartOrder));
  };

  const catData = useMemo(() => {
    const m = {};
    monthData.expenses.forEach(e => { m[e.category] = (m[e.category] || 0) + (+e.cost || 0); });
    const r = CATEGORIES.map(c => ({ name: c.name, value: m[c.name] || 0, color: c.color })).filter(c => c.value > 0);
    if (tenantP > 0) r.push({ name: 'Tenant Overage', value: tenantP, color: '#DC2626' });
    return r;
  }, [monthData.expenses, tenantP]);

  const trend = useMemo(() => {
    return allMonthKeys.slice(-6).map(k => {
      const d = allData[k] || { expenses: [], incomes: [], utilities: {} };
      const sp = calcSplit(d.utilities);
      const tp = sp?.tenant.actual || 0;
      return {
        month: k,
        Income: d.incomes.reduce((s, i) => s + (+i.amount || 0), 0),
        Expenses: d.expenses.reduce((s, e) => s + (+e.cost || 0), 0) + tp,
      };
    });
  }, [allMonthKeys, allData]);

  const topExpenses = useMemo(() => {
    return [...monthData.expenses].sort((a, b) => (+b.cost || 0) - (+a.cost || 0)).slice(0, 5);
  }, [monthData.expenses]);

  const savingsTrend = useMemo(() => {
    return allMonthKeys.slice(-6).map(k => {
      const d = allData[k] || { expenses: [], incomes: [], utilities: {} };
      const sp = calcSplit(d.utilities);
      const tp = sp?.tenant.actual || 0;
      const inc = d.incomes.reduce((s, i) => s + (+i.amount || 0), 0);
      const exp = d.expenses.reduce((s, e) => s + (+e.cost || 0), 0) + tp;
      const sav = inc - exp;
      const rate = inc > 0 ? ((sav / inc) * 100).toFixed(1) : 0;
      return { month: k, Savings: sav, 'Savings Rate %': +rate };
    });
  }, [allMonthKeys, allData]);

  const utilTrend = useMemo(() => {
    return allMonthKeys.slice(-6).map(k => {
      const d = allData[k] || { expenses: [], incomes: [], utilities: {} };
      const u = d.utilities || {};
      const water = +(u.water || 0);
      const elecBase = +(u.elecBase || 0);
      const elecMain = +(u.elecMain || 0);
      const gas = +(u.gas || 0);
      const internet = +(u.internet || 0);
      return { 
        month: k, 
        Water: water,
        'Elec (Base)': elecBase,
        'Elec (Main)': elecMain,
        Gas: gas,
        Internet: internet,
        Total: water + elecBase + elecMain + gas + internet
      };
    });
  }, [allMonthKeys, allData]);

  const yearlyCatTrend = useMemo(() => {
    // Filter months that belong to the current year
    const yearKeys = allMonthKeys.filter(k => k.startsWith(String(year)));
    const catTotals = {};
    yearKeys.forEach(k => {
      const d = allData[k] || { expenses: [] };
      d.expenses.forEach(e => {
         catTotals[e.category] = (catTotals[e.category] || 0) + (+e.cost || 0);
      });
    });
    
    // Calculate average based on number of active months in that year 
    // (or divide by 12 for a strict yearly average, let's use active months for better representation early in year)
    const numMonths = yearKeys.length || 1;
    
    return CATEGORIES.map(c => ({
      name: c.name,
      average: catTotals[c.name] ? Math.round(catTotals[c.name] / numMonths) : 0,
      color: c.color
    })).filter(c => c.average > 0).sort((a,b) => b.average - a.average);
  }, [allMonthKeys, allData, year]);

  const catMonthData = useMemo(() => {
    // Build a bar per category showing amount spent across the last 6 months
    // Each entry: { month, [catName]: amount, ... }
    return allMonthKeys.slice(-6).map(k => {
      const d = allData[k] || { expenses: [] };
      const entry = { month: k };
      CATEGORIES.forEach(c => {
        entry[c.name] = d.expenses
          .filter(e => e.category === c.name)
          .reduce((s, e) => s + (+e.cost || 0), 0);
      });
      return entry;
    });
  }, [allMonthKeys, allData]);

  // previous month comparison
  const prevKey = allMonthKeys[allMonthKeys.indexOf(key) - 1];
  const prevExp = prevKey ? (allData[prevKey]?.expenses || []).reduce((s, e) => s + (+e.cost || 0), 0) : 0;
  const expChange = prevExp ? (((totExp - prevExp) / prevExp) * 100).toFixed(1) : null;

  const expPct = totInc > 0 ? Math.round((totExp / totInc) * 100) : 0;
  const savPct = totInc > 0 ? Math.round((savings / totInc) * 100) : 0;

  return (
    <div className="dashboard">
      <div className="cards-grid">
        <SumCard icon={<Banknote size={24} />} label="Total Income" value={fmt(totInc)} cls="inc" />
        <SumCard icon={<Coins size={24} />} label="Budget Expenses" value={fmt(totExp)} cls="exp"
          sub={expPct > 0 ? `${expPct}% of income` : ''}
          subColor="#94A3B8" />
        <SumCard icon={savings >= 0 ? <TrendingUp size={24} /> : <TrendingDown size={24} />} label="Net Savings" value={fmt(savings)} cls="sav"
          valueColor={savings >= 0 ? '#10B981' : '#EF4444'}
          sub={savPct !== 0 ? `${savPct}% of income` : ''}
          subColor="#94A3B8" />
        <SumCard icon={<Zap size={24} />} label="Utility Total" value={fmt(split?.total || 0)} cls="utl" />
      </div>

      <p style={{ color: '#64748B', fontSize: '0.85rem', marginBottom: '12px', display:'flex', alignItems:'center', gap:'6px' }}><Lightbulb size={14} /> Tip: Drag and drop the charts below to rearrange your dashboard.</p>

      {/* Dynamic Draggable Charts Grid */}
      <div className="draggable-charts-grid">
        {chartOrder.map((chartId, idx) => {
          let content = null;
          let title = '';

          if (chartId === 'cat-pie') {
            title = 'Spending by Category';
            content = catData.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={catData} cx="50%" cy="50%" outerRadius={105} innerRadius={55} dataKey="value" paddingAngle={3} label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {catData.map((e, i) => <Cell key={i} fill={e.color} stroke="transparent" />)}
                  </Pie>
                  <Tooltip formatter={v => fmt(v)} contentStyle={{ background: '#1A1A28', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#F1F5F9' }} labelStyle={{ color: '#F1F5F9', fontWeight: 700 }} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <Empty />;
          } 
          
          else if (chartId === 'top-exp') {
            title = 'Top Expenses This Month';
            content = topExpenses.length ? (
              <div className="top-exp-list">
                {topExpenses.map(e => {
                  const cat = CATEGORIES.find(c => c.name === e.category);
                  return (
                    <div key={e.id} className="top-exp-item">
                      <div className="te-left">
                        <span className="te-icon" style={{ background: cat?.color + '18', color: cat?.color, border: `1px solid ${cat?.color}44` }}>{cat?.icon}</span>
                        <div className="te-info"><span className="te-desc">{e.description}</span><span className="te-cat" style={{ color: cat?.color }}>{e.category}</span></div>
                      </div>
                      <span className="te-val">{fmt(e.cost)}</span>
                    </div>
                  );
                })}
              </div>
            ) : <Empty />;
          } 
          
          else if (chartId === 'inc-exp') {
            title = 'Income vs Expenses Trend';
            content = trend.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={trend} barCategoryGap="28%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={v => fmt(v)} contentStyle={{ background: '#1A1A28', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#F1F5F9' }} labelStyle={{ color: '#F1F5F9', fontWeight: 700 }} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94A3B8' }} />
                  <Bar dataKey="Income" fill="#10B981" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Expenses" fill="#6366F1" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty />;
          } 
          
          else if (chartId === 'sav-trend') {
            title = 'Net Savings & Rate Trend';
            content = savingsTrend.some(d => d.Savings !== 0) ? (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={savingsTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={v => typeof v === 'number' && v > 100 ? fmt(v) : v + '%'} contentStyle={{ background: '#1A1A28', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#F1F5F9' }} labelStyle={{ color: '#F1F5F9', fontWeight: 700 }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94A3B8' }} />
                  <Bar yAxisId="left" dataKey="Savings" fill="#22D3EE" radius={[6, 6, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="Savings Rate %" stroke="#A78BFA" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <Empty />;
          }

          else if (chartId === 'util-trend') {
            title = 'Utility Breakdown Trend';
            content = utilTrend.some(d => d.Total > 0) ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={utilTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={v => fmt(v)} contentStyle={{ background: '#1A1A28', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#F1F5F9' }} labelStyle={{ color: '#F1F5F9', fontWeight: 700 }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94A3B8' }} />
                  <Area type="monotone" dataKey="Elec (Base)" stackId="1" stroke="#FBBF24" fill="#FBBF24" fillOpacity={0.6} />
                  <Area type="monotone" dataKey="Elec (Main)" stackId="1" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.6} />
                  <Area type="monotone" dataKey="Gas" stackId="1" stroke="#EF4444" fill="#EF4444" fillOpacity={0.6} />
                  <Area type="monotone" dataKey="Water" stackId="1" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.6} />
                  <Area type="monotone" dataKey="Internet" stackId="1" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.6} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <Empty />;
          }

          else if (chartId === 'cat-month') {
            title = 'Category Expense by Month';
            const hasData = catMonthData.some(d => CATEGORIES.some(c => d[c.name] > 0));
            content = hasData ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={catMonthData} barCategoryGap="20%" barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(v, name) => [fmt(v), name]}
                    contentStyle={{ background: '#1A1A28', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#F1F5F9', maxHeight: '300px', overflow: 'auto' }}
                    labelStyle={{ color: '#F1F5F9', fontWeight: 700 }}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, color: '#94A3B8' }} />
                  {CATEGORIES.map(c => (
                    <Bar key={c.name} dataKey={c.name} stackId="a" fill={c.color} radius={c.name === CATEGORIES[CATEGORIES.length - 1].name ? [4, 4, 0, 0] : [0,0,0,0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty />;
          }

          else if (chartId === 'yearly-trend') {
            title = `Yearly Category Average (${year})`;
            content = yearlyCatTrend.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={yearlyCatTrend} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} width={80} axisLine={false} tickLine={false} />
                  <Tooltip formatter={v => fmt(v)} contentStyle={{ background: '#1A1A28', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#F1F5F9' }} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Bar dataKey="average" radius={[0, 4, 4, 0]}>
                    {yearlyCatTrend.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty />;
          }

          else if (chartId === 'cat-bars') {
            title = 'Monthly Category Breakdown';
            content = (
              <div className="breakdown-widget">
                <div className="widget-header">
                  <div className="widget-selectors">
                    <select value={breakdownMonth} onChange={e => setBreakdownMonth(+e.target.value)} className="small-sel">
                      {MON_FULL.map((m, i) => <option key={m} value={i}>{m}</option>)}
                    </select>
                    <select value={breakdownYear} onChange={e => setBreakdownYear(+e.target.value)} className="small-sel">
                      {years.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>
                {localCatData.length ? (
                  <div className="cat-bars">
                    {[...localCatData].sort((a, b) => b.value - a.value).map(c => {
                      const maxV = Math.max(...localCatData.map(x => x.value));
                      return (
                        <div key={c.name} className={`cat-bar-row ${c.name === 'Tenant Overage' ? 'tenant-bar' : ''}`}>
                          <span className="cb-name">{c.name}</span>
                          <div className="cb-track"><div className="cb-fill" style={{ width: `${(c.value / maxV) * 100}%`, background: c.color }} /></div>
                          <span className="cb-val">{fmt(c.value)}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : <Empty />}
              </div>
            );
          }

          return (
            <div 
              key={chartId}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={(e) => handleDragEnter(e, idx)}
              onDragOver={(e) => e.preventDefault()}
              onDragEnd={handleDragEnd}
              className={`chart-card draggable-card ${draggedIdx === idx ? 'dragging' : ''}`}
            >
              <div className="drag-handle">⋮⋮</div>
              <h3>{title}</h3>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SumCard({ icon, label, value, cls, sub, subColor, valueColor }) {
  return (
    <div className={`sum-card ${cls}`}>
      <div className="sc-top">
        <div className="sc-icon">{icon}</div>
      </div>
      <div className="sc-info">
        <span className="sc-label">{label}</span>
        <span className="sc-value" style={valueColor ? { color: valueColor } : {}}>{value}</span>
        {sub && <span className="sc-sub" style={{ color: subColor }}>{sub}</span>}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="empty-chart">
      <span style={{ fontSize: 28, opacity: 0.3 }}>📊</span>
      <span>No data yet for this month</span>
    </div>
  );
}

/* ═══════════════════════════════════════════
   BUDGET TRACKER
   ═══════════════════════════════════════════ */

function BudgetTracker({ expenses, addExp, delExp, updExp, year, monthIdx, totExp, tenantP }) {
  const blank = { date: dateDefault(year, monthIdx), description: '', cost: '', category: CATEGORIES[0].name };
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState(null);
  const [filter, setFilter] = useState('All');

  useEffect(() => { setForm(f => ({ ...f, date: dateDefault(year, monthIdx) })); }, [year, monthIdx]);

  const submit = e => {
    e.preventDefault();
    if (!form.description || !form.cost) return;
    editId ? updExp(editId, form) : addExp(form);
    setEditId(null);
    setForm(blank);
  };

  const startEdit = exp => { setForm({ date: exp.date, description: exp.description, cost: exp.cost, category: exp.category }); setEditId(exp.id); };
  const cancelEdit = () => { setEditId(null); setForm(blank); };

  const filtered = filter === 'All' ? expenses : expenses.filter(e => e.category === filter);
  const catTotals = useMemo(() => {
    const m = {};
    expenses.forEach(e => { m[e.category] = (m[e.category] || 0) + (+e.cost || 0); });
    return m;
  }, [expenses]);

  return (
    <div className="page-budget">
      {/* Add / Edit form */}
      <div className="card">
        <h3>{editId ? <><Edit size={20} className="mr-2 inline" /> Edit Expense</> : <><Plus size={20} className="mr-2 inline" /> Add Expense</>}</h3>
        <form onSubmit={submit} className="row-form">
          <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
          <input type="text" placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required />
          <input type="number" step="0.01" min="0" placeholder="Amount ($)" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} required />
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.icon} {c.name}</option>)}
          </select>
          <button type="submit" className="btn btn-pri">{editId ? 'Update' : 'Add'}</button>
          {editId && <button type="button" className="btn btn-sec" onClick={cancelEdit}>Cancel</button>}
        </form>
      </div>


      {/* Category chips */}
      <div className="card">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><ClipboardList size={20} /> Category Breakdown</h3>
        <div className="chip-grid">
          {CATEGORIES.map(c => (
            <div key={c.name} className="chip" style={{ borderLeft: `4px solid ${c.color}` }}>
              <span>{c.icon} {c.name}</span><strong>{fmt(catTotals[c.name] || 0)}</strong>
            </div>
          ))}
          {tenantP > 0 && <div className="chip tenant-chip"><span><Home size={16} style={{ display:'inline', verticalAlign:'sub'}} /> Tenant Overage</span><strong>{fmt(tenantP)}</strong></div>}
        </div>
      </div>

      {/* Expense table */}
      <div className="card">
        <div className="card-head">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><CreditCard size={20} /> Expenses ({filtered.length})</h3>
          <select value={filter} onChange={e => setFilter(e.target.value)} className="filter-sel">
            <option value="All">All Categories</option>
            {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.icon} {c.name}</option>)}
          </select>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th>Actions</th></tr></thead>
            <tbody>
              {tenantP > 0 && filter === 'All' && (
                <tr className="tenant-expense-row">
                  <td>—</td><td><strong><Home size={16} style={{display:'inline', verticalAlign:'sub'}}/> Tenant Utility Overage</strong></td>
                  <td><span className="badge tenant-badge"><Home size={14} style={{display:'inline', verticalAlign:'sub'}}/> Tenant</span></td>
                  <td className="amt tenant-amt">{fmt(tenantP)}</td>
                  <td><span className="auto-tag">Auto</span></td>
                </tr>
              )}
              {filtered.length === 0 && tenantP === 0
                ? <tr><td colSpan="5" className="empty-row">No expenses</td></tr>
                : [...filtered].sort((a, b) => b.date.localeCompare(a.date)).map(exp => {
                  const cat = CATEGORIES.find(c => c.name === exp.category);
                  return (
                    <tr key={exp.id}>
                      <td>{exp.date}</td><td>{exp.description}</td>
                      <td><span className="badge" style={{ background: cat?.color + '18', color: cat?.color, border: `1px solid ${cat?.color}44` }}>{cat?.icon} {exp.category}</span></td>
                      <td className="amt">{fmt(exp.cost)}</td>
                      <td className="actions">
                        <button onClick={() => startEdit(exp)} title="Edit" style={{ display:'flex', alignItems:'center', justifyContent:'center' }}><Edit size={16} /></button>
                        <button onClick={() => delExp(exp.id)} title="Delete" style={{ display:'flex', alignItems:'center', justifyContent:'center' }}><Trash2 size={16} /></button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            {(filtered.length > 0 || tenantP > 0) && (
              <tfoot><tr className="tfoot-row"><td colSpan="3"><strong>Total</strong></td><td className="amt"><strong>{fmt(totExp + (filter === 'All' ? tenantP : 0))}</strong></td><td></td></tr></tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   UTILITY MANAGER
   ═══════════════════════════════════════════ */

function UtilityManager({ util, save: saveUtil, sheetKey }) {
  const blank = { water: '', elecBase: '', elecMain: '', gas: '', internet: '' };
  const [form, setForm] = useState(blank);
  const [tab, setTab] = useState('tenant');

  useEffect(() => { setForm(util && Object.keys(util).length ? util : blank); }, [util, sheetKey]); // eslint-disable-line

  const handleSave = e => { e.preventDefault(); saveUtil(form); };
  const sp = calcSplit(form);

  return (
    <div className="page-util">
      <div className="card">
        <h3 style={{ display:'flex', alignItems:'center', gap:'8px' }}><Zap size={20} /> Utility Costs — {sheetKey}</h3>
        <form onSubmit={handleSave} className="util-form">
          <div className="uf-grid">
            {[[<><Droplet size={16} className="inline mr-1" /> Water (Full House)</>, 'water'], [<><Lightbulb size={16} className="inline mr-1" /> Electricity (Basement)</>, 'elecBase'], [<><Lightbulb size={16} className="inline mr-1" /> Electricity (Main Unit)</>, 'elecMain'], [<><Flame size={16} className="inline mr-1" /> Gas (Full House)</>, 'gas'], [<><Globe size={16} className="inline mr-1" /> Internet</>, 'internet']].map(([lbl, k]) => (
              <div key={k} className="fg">
                <label>{lbl}</label>
                <input type="number" step="0.01" min="0" placeholder="0.00" value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="uf-actions">
            <button type="submit" className="btn btn-pri" style={{ display:'flex', alignItems:'center', gap:'8px' }}><Save size={18} /> Save Utilities</button>
            <span className="tot-badge">Total: {fmt(sp?.total || 0)}</span>
          </div>
        </form>
      </div>
      {sp && sp.total > 0 && (
        <>
          <div className="card">
            <div className="tab-bar">
              <button className={`tab ${tab === 'tenant' ? 'on' : ''}`} onClick={() => setTab('tenant')} style={{ display:'flex', alignItems:'center', gap:'6px' }}><Home size={16} /> Tenant</button>
              <button className={`tab ${tab === 'landlord' ? 'on' : ''}`} onClick={() => setTab('landlord')} style={{ display:'flex', alignItems:'center', gap:'6px' }}><Building2 size={16} /> Landlord</button>
            </div>

            {tab === 'tenant' && (
              <div className="split-view">
                <h3 style={{ display:'flex', alignItems:'center', gap:'8px' }}><Home size={20} /> Tenant's Breakdown</h3>
                <div className="split-rows">
                  <Row l="Water (40%)" v={sp.tenant.water} />
                  <Row l="Electricity – Basement (100%)" v={sp.tenant.elec} />
                  <Row l="Gas (40%)" v={sp.tenant.gas} />
                  <Row l="Calculated Share" v={sp.tenant.calc} cls="sub" />
                  <Row l="Cap Threshold" v={TENANT_CAP} cls="sub" />
                </div>
                <div className={`overage-result ${sp.tenant.isOver ? 'over' : 'under'}`}>
                  {sp.tenant.isOver ? (
                    <>
                      <div className="or-calc">
                        <span>{fmt(sp.tenant.calc)}</span><span className="or-minus">−</span><span>${TENANT_CAP}</span><span className="or-equals">=</span>
                      </div>
                      <div className="or-amount"><span className="or-label">Tenant Pays (Overage)</span><span className="or-value">{fmt(sp.tenant.overage)}</span></div>
                    </>
                  ) : (
                    <div className="or-amount"><span className="or-label">Tenant Pays</span><span className="or-value">{fmt(0)}</span></div>
                  )}
                </div>
                <div className={`info-box ${sp.tenant.isOver ? 'warn' : 'ok'}`}>
                  {sp.tenant.isOver
                    ? `⚠️ Calc (${fmt(sp.tenant.calc)}) exceeds $${TENANT_CAP} by ${fmt(sp.tenant.overage)}. Tenant pays ${fmt(sp.tenant.overage)}.`
                    : `✅ Calc (${fmt(sp.tenant.calc)}) ≤ $${TENANT_CAP}. Tenant pays $0.`}
                </div>
              </div>
            )}

            {tab === 'landlord' && (
              <div className="split-view">
                <h3 style={{ display:'flex', alignItems:'center', gap:'8px' }}><Building2 size={20} /> Landlord's Breakdown</h3>
                <p className="landlord-note">Landlord pays the <strong>full bill</strong>. Tenant reimburses overage only.</p>
                <div className="split-rows">
                  <Row l={<><Droplet size={14} className="inline mr-1" /> Water</>} v={+(form.water || 0)} />
                  <Row l={<><Lightbulb size={14} className="inline mr-1" /> Elec – Basement</>} v={+(form.elecBase || 0)} />
                  <Row l={<><Lightbulb size={14} className="inline mr-1" /> Elec – Main</>} v={+(form.elecMain || 0)} />
                  <Row l={<><Flame size={14} className="inline mr-1" /> Gas</>} v={+(form.gas || 0)} />
                  <Row l={<><Globe size={14} className="inline mr-1" /> Internet</>} v={+(form.internet || 0)} />
                  <Row l="Total Bill (Landlord Pays)" v={sp.landlord.totalBill} cls="total" />
                </div>
                <div className="mini-cards">
                  <div className="mc"><span>Total Bill</span><strong>{fmt(sp.landlord.totalBill)}</strong></div>
                  <div className={`mc ${sp.landlord.tenantReimbursement > 0 ? 'mc-green' : ''}`}>
                    <span>Tenant Reimburses</span><strong>{fmt(sp.landlord.tenantReimbursement)}</strong>
                  </div>
                  <div className="mc mc-highlight"><span>Landlord Net</span><strong>{fmt(sp.landlord.netCost)}</strong></div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ l, v, cls = '' }) {
  return <div className={`sr ${cls}`}><span>{l}</span><span>{fmt(v)}</span></div>;
}

/* ═══════════════════════════════════════════
   INCOME MANAGER
   ═══════════════════════════════════════════ */

function IncomeManager({ incomes, addInc, delInc, year, monthIdx, totInc }) {
  const blank = { date: dateDefault(year, monthIdx), description: '', amount: '' };
  const [form, setForm] = useState(blank);

  useEffect(() => { setForm(f => ({ ...f, date: dateDefault(year, monthIdx) })); }, [year, monthIdx]);

  const submit = e => {
    e.preventDefault();
    if (!form.description || !form.amount) return;
    addInc(form);
    setForm(blank);
  };

  return (
    <div className="page-income">
      <div className="card">
        <h3 style={{ display:'flex', alignItems:'center', gap:'8px' }}><Plus size={20} /> Add Income</h3>
        <form onSubmit={submit} className="row-form">
          <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
          <input type="text" placeholder="Description (e.g. Salary)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required />
          <input type="number" step="0.01" min="0" placeholder="Amount ($)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
          <button type="submit" className="btn btn-pri">Add</button>
        </form>
      </div>
      <div className="card">
        <h3 style={{ display:'flex', alignItems:'center', gap:'8px' }}><Banknote size={20} /> Income — Total: {fmt(totInc)}</h3>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Actions</th></tr></thead>
            <tbody>
              {incomes.length === 0
                ? <tr><td colSpan="4" className="empty-row">No income recorded</td></tr>
                : [...incomes].sort((a, b) => b.date.localeCompare(a.date)).map(inc => (
                  <tr key={inc.id}><td>{inc.date}</td><td>{inc.description}</td>
                    <td className="amt inc-amt">{fmt(inc.amount)}</td>
                    <td className="actions"><button onClick={() => delInc(inc.id)} style={{ display:'flex', alignItems:'center', justifyContent:'center' }}><Trash2 size={16} /></button></td></tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SETTINGS
   ═══════════════════════════════════════════ */

function Settings({ allData, setAllData, cloudStatus, db, handleDownload }) {
  const reqNotif = () => {
    if ('Notification' in window) {
      Notification.requestPermission().then(p => alert(p === 'granted' ? 'Enabled!' : 'Denied'));
    } else alert('Not supported.');
  };

  const sheetCount = Object.keys(allData).length;
  const totalExp = Object.values(allData).reduce((s, d) => s + (d.expenses?.length || 0), 0);
  const totalInc = Object.values(allData).reduce((s, d) => s + (d.incomes?.length || 0), 0);

  return (
    <div className="page-settings">
      {/* File Status */}
      <div className="card">
        <h3 style={{ display:'flex', alignItems:'center', gap:'8px' }}><Database size={20} /> Storage Status</h3>
        <div className="file-status-grid">
          
          <div className={`fs-card ${db && cloudStatus !== 'error' && cloudStatus !== 'disconnected' ? 'connected' : 'disconnected'}`}>
            <span className="fs-icon"><Cloud size={24} /></span>
            <div>
              <strong>Firebase Cloud Database</strong>
              <p>{db ? `Status: ${cloudStatus.toUpperCase()}` : 'Keys missing in src/firebase.js'}</p>
            </div>
          </div>

        </div>
        <div className="set-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-sec" onClick={handleDownload} style={{ display:'flex', alignItems:'center', gap:'8px' }}><Download size={18} /> Export Data to Excel</button>
        </div>
      </div>
    </div>
  );
}