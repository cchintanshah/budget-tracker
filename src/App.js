import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import * as XLSX from 'xlsx';
import './App.css';

/* ═══════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════ */

const CATEGORIES = [
  { name: 'Grocery',             color: '#10B981', icon: '🛒' },
  { name: 'Eat Outside',         color: '#F59E0B', icon: '🍔' },
  { name: 'Car Related',         color: '#EF4444', icon: '🚗' },
  { name: 'Mobile',              color: '#8B5CF6', icon: '📱' },
  { name: 'Presto - Commute',    color: '#06B6D4', icon: '🚌' },
  { name: 'Utility',             color: '#F97316', icon: '💡' },
  { name: 'Miscellaneous',       color: '#EC4899', icon: '📦' },
  { name: 'Mortgage',            color: '#6366F1', icon: '🏠' },
  { name: 'Remittance to India', color: '#14B8A6', icon: '💸' },
];

const TENANT_CAP = 200;
const MON_SHORT  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MON_FULL   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CUR_YEAR   = new Date().getFullYear();
const CUR_MONTH  = new Date().getMonth();
const SUPPORTS_FS = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */

const uid  = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const fmt  = (n) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);
const mkKey   = (y, m) => `${MON_SHORT[m]} ${y}`;
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
    tenant:   { water: tW, gas: tG, elec: tE, calc: tCalc, overage: tOverage, actual: tOverage, isOver: tCalc > TENANT_CAP },
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
    rows.push(['Water (Full House)',       +(+utilities.water    || 0).toFixed(2)]);
    rows.push(['Electricity (Basement)',   +(+utilities.elecBase || 0).toFixed(2)]);
    rows.push(['Electricity (Main)',       +(+utilities.elecMain || 0).toFixed(2)]);
    rows.push(['Gas (Full House)',         +(+utilities.gas      || 0).toFixed(2)]);
    rows.push(['Internet',                +(+utilities.internet || 0).toFixed(2)]);
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

      if (c0 === '=== EXPENSES ===')      { mode = 'exp';  headerSkip = false; continue; }
      if (c0 === '=== INCOME ===')        { mode = 'inc';  headerSkip = false; continue; }
      if (c0 === '=== UTILITIES ===')     { mode = 'util'; headerSkip = false; continue; }
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
        const val  = String(row[1] || '');
        if (item.includes('water'))            result.utilities.water    = val;
        else if (item.includes('basement'))    result.utilities.elecBase = val;
        else if (item.includes('main'))        result.utilities.elecMain = val;
        else if (item.includes('gas'))         result.utilities.gas      = val;
        else if (item.includes('internet'))    result.utilities.internet = val;
      }
    }
    allData[name] = result;
  }
  return allData;
}

async function writeToHandle(handle, allData) {
  const wb   = buildWorkbook(allData);
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
  const [allData, setAllData]     = useState(() => load('bpro_data', {}));
  const [year, setYear]           = useState(CUR_YEAR);
  const [monthIdx, setMonthIdx]   = useState(CUR_MONTH);
  const [page, setPage]           = useState('dashboard');
  const [fileConnected, setFileConnected] = useState(false);
  const [fileName, setFileName]   = useState('');
  const [saveStatus, setSaveStatus] = useState('idle');
  const [sbOpen, setSbOpen]       = useState(window.innerWidth > 768);

  const fileHandleRef = useRef(null);
  const saveTimerRef  = useRef(null);
  const firstRender   = useRef(true);
  const fileInputRef  = useRef(null);

  const key       = mkKey(year, monthIdx);
  const monthData = useMemo(() => allData[key] || { expenses: [], incomes: [], utilities: {} }, [allData, key]);
  const split     = calcSplit(monthData.utilities);
  const tenantP   = split?.tenant.actual || 0;
  const totExp    = monthData.expenses.reduce((s, e) => s + (+e.cost || 0), 0);
  const totInc    = monthData.incomes.reduce((s, i) => s + (+i.amount || 0), 0);

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

  /* ── auto-save to localStorage + file ── */
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    save('bpro_data', allData);

    if (fileHandleRef.current) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveStatus('pending');
      saveTimerRef.current = setTimeout(async () => {
        try {
          setSaveStatus('saving');
          await writeToHandle(fileHandleRef.current, allData);
          setSaveStatus('saved');
        } catch (e) {
          console.error('File save error:', e);
          setSaveStatus('error');
        }
      }, 800);
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
  const addExp   = (e) => updateMonth(d => ({ ...d, expenses: [...d.expenses, { ...e, id: uid() }] }));
  const delExp   = (id) => updateMonth(d => ({ ...d, expenses: d.expenses.filter(e => e.id !== id) }));
  const updExp   = (id, u) => updateMonth(d => ({ ...d, expenses: d.expenses.map(e => e.id === id ? { ...e, ...u } : e) }));
  const addInc   = (i) => updateMonth(d => ({ ...d, incomes: [...d.incomes, { ...i, id: uid() }] }));
  const delInc   = (id) => updateMonth(d => ({ ...d, incomes: d.incomes.filter(i => i.id !== id) }));
  const saveUtil = (u) => updateMonth(d => ({ ...d, utilities: u }));

  /* ── File System Access API ── */
  const handleNewFile = async () => {
    if (!SUPPORTS_FS) { downloadWorkbook(allData); return; }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'BudgetPro.xlsx',
        types: [{ description: 'Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }]
      });
      fileHandleRef.current = handle;
      setFileName(handle.name);
      setFileConnected(true);
      await writeToHandle(handle, allData);
      setSaveStatus('saved');
    } catch (e) { if (e.name !== 'AbortError') alert('Error: ' + e.message); }
  };

  const handleOpenFile = async () => {
    if (!SUPPORTS_FS) { fileInputRef.current?.click(); return; }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }]
      });
      fileHandleRef.current = handle;
      setFileName(handle.name);
      setFileConnected(true);
      const file = await handle.getFile();
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf);
      const data = parseWorkbook(wb);
      setAllData(data);
      save('bpro_data', data);
      setSaveStatus('saved');

      // Navigate to first available month
      const firstKey = Object.keys(data).sort((a, b) => { const pa = parseKey(a), pb = parseKey(b); return (pb.year - pa.year) || (pb.month - pa.month); })[0];
      if (firstKey) { const p = parseKey(firstKey); setYear(p.year); setMonthIdx(p.month); }
    } catch (e) { if (e.name !== 'AbortError') alert('Error: ' + e.message); }
  };

  /* fallback file input */
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb   = XLSX.read(ev.target.result);
        const data = parseWorkbook(wb);
        setAllData(data);
        save('bpro_data', data);
        setFileName(file.name);
        const firstKey = Object.keys(data).sort((a, b) => { const pa = parseKey(a), pb = parseKey(b); return (pb.year - pa.year) || (pb.month - pa.month); })[0];
        if (firstKey) { const p = parseKey(firstKey); setYear(p.year); setMonthIdx(p.month); }
        alert('✅ Data loaded from ' + file.name);
      } catch { alert('❌ Could not parse the file.'); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleDownload = () => downloadWorkbook(allData);

  const nav = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'budget',    label: 'Budget',    icon: '💰' },
    { id: 'utilities', label: 'Utilities', icon: '⚡' },
    { id: 'income',    label: 'Income',    icon: '💵' },
    { id: 'settings',  label: 'Settings',  icon: '⚙️' },
  ];

  const isThe13 = new Date().getDate() === 13;

  return (
    <div className="app">
      {/* ── SIDEBAR ── */}
      <aside className={`sidebar ${sbOpen ? 'open' : ''}`}>
        <div className="sb-head">
          {sbOpen && <h2>💰 BudgetPro</h2>}
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
          <div className="sb-file-info">
            <div className={`file-dot ${fileConnected ? 'green' : 'gray'}`} />
            <span>{fileConnected ? fileName : 'No file'}</span>
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

            <div className="tb-divider" />

            {/* File buttons */}
            <button className="btn btn-file" onClick={handleOpenFile} title="Open Excel File">📂</button>
            <button className="btn btn-file" onClick={handleNewFile} title={SUPPORTS_FS ? 'Create / Save As' : 'Download Excel'}>
              {SUPPORTS_FS ? '📝' : '📥'}
            </button>
            <button className="btn btn-file" onClick={handleDownload} title="Download Excel">💾</button>

            {/* Save status */}
            {fileConnected && (
              <span className={`save-badge ${saveStatus}`}>
                {saveStatus === 'saved' && '✅'}
                {saveStatus === 'saving' && '⏳'}
                {saveStatus === 'pending' && '🔄'}
                {saveStatus === 'error' && '❌'}
                {saveStatus === 'idle' && '💤'}
              </span>
            )}
          </div>
          <input type="file" ref={fileInputRef} accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileUpload} />
        </header>

        {/* ── File Connection Banner ── */}
        {!fileConnected && (
          <div className="file-banner">
            <span>📁</span>
            <div>
              <strong>Connect an Excel file</strong>
              <p>Your budget data will be saved to an Excel file with each month as a separate tab.</p>
            </div>
            <div className="fb-actions">
              <button className="btn btn-pri" onClick={handleOpenFile}>📂 Open Existing</button>
              <button className="btn btn-sec" onClick={handleNewFile}>
                {SUPPORTS_FS ? '📝 Create New' : '📥 Download Current'}
              </button>
            </div>
          </div>
        )}

        {isThe13 && (
          <div className="reminder-banner">
            🔔 <strong>Reminder:</strong> It's the 13th — add your utility costs!
            <button onClick={() => setPage('utilities')}>Go to Utilities →</button>
          </div>
        )}

        {/* ── Active Sheet Badge ── */}
        <div className="sheet-badge-bar">
          <span className="sheet-label">📄 Active Sheet:</span>
          <span className="sheet-name">{key}</span>
          {allData[key] && <span className="sheet-exists">● Exists in file</span>}
          {!allData[key] && <span className="sheet-new">● New — will be created on first save</span>}
        </div>

        <div className="content">
          {page === 'dashboard' && (
            <Dashboard allData={allData} monthData={monthData} split={split} tenantP={tenantP}
              totExp={totExp} totInc={totInc} year={year} monthIdx={monthIdx}
              allMonthKeys={allMonthKeys} />
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
              fileConnected={fileConnected} fileName={fileName}
              handleDownload={handleDownload} handleOpenFile={handleOpenFile}
              fileInputRef={fileInputRef} />
          )}
        </div>
      </main>
    </div>
  );
}

/* ═══════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════ */

function Dashboard({ allData, monthData, split, tenantP, totExp, totInc, year, monthIdx, allMonthKeys }) {
  const savings     = totInc - totExp - tenantP;
  const totalOutflow = totExp + tenantP;
  const key = mkKey(year, monthIdx);

  const catData = useMemo(() => {
    const m = {};
    monthData.expenses.forEach(e => { m[e.category] = (m[e.category] || 0) + (+e.cost || 0); });
    const r = CATEGORIES.map(c => ({ name: c.name, value: m[c.name] || 0, color: c.color })).filter(c => c.value > 0);
    if (tenantP > 0) r.push({ name: 'Tenant Overage', value: tenantP, color: '#DC2626' });
    return r;
  }, [monthData.expenses, tenantP]);

  const trend = useMemo(() => {
    return allMonthKeys.slice(-6).map(k => {
      const d  = allData[k] || { expenses: [], incomes: [], utilities: {} };
      const sp = calcSplit(d.utilities);
      const tp = sp?.tenant.actual || 0;
      return {
        month: k,
        Income:   d.incomes.reduce((s, i) => s + (+i.amount || 0), 0),
        Expenses: d.expenses.reduce((s, e) => s + (+e.cost || 0), 0) + tp,
      };
    });
  }, [allMonthKeys, allData]);

  const utilTrend = useMemo(() => {
    return allMonthKeys.slice(-6).map(k => {
      const d  = allData[k] || { expenses: [], incomes: [], utilities: {} };
      const sp = calcSplit(d.utilities);
      return { month: k, 'Total Bill': sp?.total || 0, 'Tenant Overage': sp?.tenant.actual || 0, 'Landlord Net': sp?.landlord.netCost || 0 };
    });
  }, [allMonthKeys, allData]);

  // previous month comparison
  const prevKey = allMonthKeys[allMonthKeys.indexOf(key) - 1];
  const prevExp = prevKey ? (allData[prevKey]?.expenses || []).reduce((s, e) => s + (+e.cost || 0), 0) : 0;
  const expChange = prevExp ? (((totExp - prevExp) / prevExp) * 100).toFixed(1) : null;

  return (
    <div className="dashboard">
      <div className="cards-grid">
        <SumCard icon="💵" label="Total Income" value={fmt(totInc)} cls="inc" />
        <SumCard icon="💸" label="Budget Expenses" value={fmt(totExp)} cls="exp"
          sub={expChange !== null ? `${expChange > 0 ? '↑' : '↓'} ${Math.abs(expChange)}% vs prev month` : null}
          subColor={expChange > 0 ? '#EF4444' : '#10B981'} />
        <SumCard icon={savings >= 0 ? '📈' : '📉'} label="Net Savings" value={fmt(savings)} cls="sav"
          valueColor={savings >= 0 ? '#10B981' : '#EF4444'} />
        <SumCard icon="⚡" label="Utility Total" value={fmt(split?.total || 0)} cls="utl" />
      </div>

      {/* Tenant Overage Banner */}
      {tenantP > 0 && (
        <div className="tenant-overage-banner">
          <div className="tob-left">
            <span className="tob-icon">🏠</span>
            <div>
              <h4>Tenant Utility Overage</h4>
              <p>Share ({fmt(split?.tenant.calc)}) exceeds ${TENANT_CAP} cap by <strong>{fmt(tenantP)}</strong>.</p>
            </div>
          </div>
          <div className="tob-right">
            <span className="tob-amount">{fmt(tenantP)}</span>
            <span className="tob-label">Tenant Owes</span>
          </div>
        </div>
      )}
      {tenantP === 0 && split && split.total > 0 && (
        <div className="tenant-zero-banner">
          <span>✅</span>
          <div><strong>Tenant owes $0</strong><p>Calc ({fmt(split.tenant.calc)}) ≤ ${TENANT_CAP}. Landlord covers full {fmt(split.total)}.</p></div>
        </div>
      )}

      {/* Outflow Summary */}
      <div className="outflow-summary">
        <div className="os-row"><span>Budget Expenses</span><span>{fmt(totExp)}</span></div>
        {tenantP > 0 && <div className="os-row tenant-row"><span>+ Tenant Utility Overage</span><span className="tenant-highlight">{fmt(tenantP)}</span></div>}
        <div className="os-row os-total"><span>Total Outflow</span><span>{fmt(totalOutflow)}</span></div>
        <div className={`os-row os-savings ${savings >= 0 ? 'positive' : 'negative'}`}>
          <span>Net Savings</span><span>{fmt(savings)}</span>
        </div>
      </div>

      {/* Charts */}
      <div className="charts-row">
        <div className="chart-card">
          <h3>Spending by Category</h3>
          {catData.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={catData} cx="50%" cy="50%" outerRadius={100} innerRadius={50} dataKey="value" paddingAngle={2}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {catData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={v => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </div>
        <div className="chart-card">
          <h3>Income vs Expenses Trend</h3>
          {trend.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={v => fmt(v)} />
                <Legend />
                <Bar dataKey="Income" fill="#10B981" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Expenses" fill="#EF4444" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </div>
      </div>

      <div className="charts-row">
        <div className="chart-card">
          <h3>Utility Trend</h3>
          {utilTrend.some(d => d['Total Bill'] > 0) ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={utilTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={v => fmt(v)} />
                <Legend />
                <Area type="monotone" dataKey="Total Bill" stroke="#F97316" fill="#FFEDD5" strokeWidth={2} />
                <Area type="monotone" dataKey="Tenant Overage" stroke="#DC2626" fill="#FEE2E2" strokeWidth={2} />
                <Area type="monotone" dataKey="Landlord Net" stroke="#06B6D4" fill="#CFFAFE" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </div>
        <div className="chart-card">
          <h3>Category Breakdown</h3>
          {catData.length ? (
            <div className="cat-bars">
              {[...catData].sort((a, b) => b.value - a.value).map(c => {
                const maxV = Math.max(...catData.map(x => x.value));
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
      </div>
    </div>
  );
}

function SumCard({ icon, label, value, cls, sub, subColor, valueColor }) {
  return (
    <div className={`sum-card ${cls}`}>
      <div className="sc-icon">{icon}</div>
      <div className="sc-info">
        <span className="sc-label">{label}</span>
        <span className="sc-value" style={valueColor ? { color: valueColor } : {}}>{value}</span>
        {sub && <span className="sc-sub" style={{ color: subColor }}>{sub}</span>}
      </div>
    </div>
  );
}

function Empty() { return <div className="empty-chart">No data for this month</div>; }

/* ═══════════════════════════════════════════
   BUDGET TRACKER
   ═══════════════════════════════════════════ */

function BudgetTracker({ expenses, addExp, delExp, updExp, year, monthIdx, totExp, tenantP }) {
  const blank = { date: dateDefault(year, monthIdx), description: '', cost: '', category: CATEGORIES[0].name };
  const [form, setForm]     = useState(blank);
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

  const startEdit  = exp => { setForm({ date: exp.date, description: exp.description, cost: exp.cost, category: exp.category }); setEditId(exp.id); };
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
        <h3>{editId ? '✏️ Edit Expense' : '➕ Add Expense'}</h3>
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

      {/* Budget summary with tenant portion */}
      <div className="card budget-summary-card">
        <h3>📊 Monthly Budget Summary — {mkKey(year, monthIdx)}</h3>
        <div className="budget-summary-grid">
          <div className="bs-item"><span className="bs-label">Budget Expenses</span><span className="bs-value">{fmt(totExp)}</span></div>
          <div className={`bs-item ${tenantP > 0 ? 'bs-tenant-active' : 'bs-tenant-zero'}`}>
            <span className="bs-label">🏠 Tenant Overage</span><span className="bs-value">{fmt(tenantP)}</span>
          </div>
          <div className="bs-item bs-total"><span className="bs-label">Total Outflow</span><span className="bs-value">{fmt(totExp + tenantP)}</span></div>
        </div>
        {tenantP > 0 && <div className="tenant-note">⚠️ <strong>{fmt(tenantP)}</strong> owed by tenant (utility overage above ${TENANT_CAP} cap).</div>}
        {tenantP === 0 && <div className="tenant-note-ok">✅ No tenant utility overage this month.</div>}
      </div>

      {/* Category chips */}
      <div className="card">
        <h3>📋 Category Breakdown</h3>
        <div className="chip-grid">
          {CATEGORIES.map(c => (
            <div key={c.name} className="chip" style={{ borderLeft: `4px solid ${c.color}` }}>
              <span>{c.icon} {c.name}</span><strong>{fmt(catTotals[c.name] || 0)}</strong>
            </div>
          ))}
          {tenantP > 0 && <div className="chip tenant-chip"><span>🏠 Tenant Overage</span><strong>{fmt(tenantP)}</strong></div>}
        </div>
      </div>

      {/* Expense table */}
      <div className="card">
        <div className="card-head">
          <h3>💳 Expenses ({filtered.length})</h3>
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
                  <td>—</td><td><strong>🏠 Tenant Utility Overage</strong></td>
                  <td><span className="badge tenant-badge">🏠 Tenant</span></td>
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
                          <button onClick={() => startEdit(exp)} title="Edit">✏️</button>
                          <button onClick={() => delExp(exp.id)} title="Delete">🗑️</button>
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
  const [tab, setTab]   = useState('tenant');

  useEffect(() => { setForm(util && Object.keys(util).length ? util : blank); }, [util, sheetKey]); // eslint-disable-line

  const handleSave = e => { e.preventDefault(); saveUtil(form); };
  const sp = calcSplit(form);

  return (
    <div className="page-util">
      <div className="card">
        <h3>⚡ Utility Costs — {sheetKey}</h3>
        <form onSubmit={handleSave} className="util-form">
          <div className="uf-grid">
            {[['🚿 Water (Full House)', 'water'],['💡 Electricity (Basement)', 'elecBase'],['💡 Electricity (Main Unit)', 'elecMain'],['🔥 Gas (Full House)', 'gas'],['🌐 Internet', 'internet']].map(([lbl, k]) => (
              <div key={k} className="fg">
                <label>{lbl}</label>
                <input type="number" step="0.01" min="0" placeholder="0.00" value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="uf-actions">
            <button type="submit" className="btn btn-pri">💾 Save Utilities</button>
            <span className="tot-badge">Total: {fmt(sp?.total || 0)}</span>
          </div>
        </form>
      </div>

      {sp && sp.total > 0 && (
        <>
          {/* Rules */}
          <div className="card rules-card">
            <h3>📐 Split Rules</h3>
            <div className="rules-grid">
              <div className="rule"><span className="rule-icon">🚿</span><div><strong>Water</strong><br/>T: 40% · L: 60%</div></div>
              <div className="rule"><span className="rule-icon">💡</span><div><strong>Elec (Basement)</strong><br/>T: 100% · L: 0%</div></div>
              <div className="rule"><span className="rule-icon">💡</span><div><strong>Elec (Main)</strong><br/>T: 0% · L: 100%</div></div>
              <div className="rule"><span className="rule-icon">🔥</span><div><strong>Gas</strong><br/>T: 40% · L: 60%</div></div>
              <div className="rule"><span className="rule-icon">🌐</span><div><strong>Internet</strong><br/>T: 0% · L: 100%</div></div>
              <div className="rule rule-cap"><span className="rule-icon">🎯</span><div><strong>Cap: ${TENANT_CAP}</strong><br/>Tenant pays $0 if under. Only overage above ${TENANT_CAP}.</div></div>
            </div>
          </div>

          {/* Tabs */}
          <div className="card">
            <div className="tab-bar">
              <button className={`tab ${tab === 'tenant' ? 'on' : ''}`} onClick={() => setTab('tenant')}>🏠 Tenant</button>
              <button className={`tab ${tab === 'landlord' ? 'on' : ''}`} onClick={() => setTab('landlord')}>🏢 Landlord</button>
            </div>

            {tab === 'tenant' && (
              <div className="split-view">
                <h3>🏠 Tenant's Breakdown</h3>
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
                <h3>🏢 Landlord's Breakdown</h3>
                <p className="landlord-note">Landlord pays the <strong>full bill</strong>. Tenant reimburses overage only.</p>
                <div className="split-rows">
                  <Row l="🚿 Water" v={+(form.water || 0)} />
                  <Row l="💡 Elec – Basement" v={+(form.elecBase || 0)} />
                  <Row l="💡 Elec – Main" v={+(form.elecMain || 0)} />
                  <Row l="🔥 Gas" v={+(form.gas || 0)} />
                  <Row l="🌐 Internet" v={+(form.internet || 0)} />
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
        <h3>➕ Add Income</h3>
        <form onSubmit={submit} className="row-form">
          <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
          <input type="text" placeholder="Description (e.g. Salary)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required />
          <input type="number" step="0.01" min="0" placeholder="Amount ($)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
          <button type="submit" className="btn btn-pri">Add</button>
        </form>
      </div>
      <div className="card">
        <h3>💵 Income — Total: {fmt(totInc)}</h3>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Actions</th></tr></thead>
            <tbody>
              {incomes.length === 0
                ? <tr><td colSpan="4" className="empty-row">No income recorded</td></tr>
                : [...incomes].sort((a, b) => b.date.localeCompare(a.date)).map(inc => (
                    <tr key={inc.id}><td>{inc.date}</td><td>{inc.description}</td>
                    <td className="amt inc-amt">{fmt(inc.amount)}</td>
                    <td className="actions"><button onClick={() => delInc(inc.id)}>🗑️</button></td></tr>
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

function Settings({ allData, setAllData, fileConnected, fileName, handleDownload, handleOpenFile, fileInputRef }) {
  const reqNotif = () => {
    if ('Notification' in window) {
      Notification.requestPermission().then(p => alert(p === 'granted' ? '✅ Enabled!' : '❌ Denied'));
    } else alert('Not supported.');
  };

  const sheetCount = Object.keys(allData).length;
  const totalExp   = Object.values(allData).reduce((s, d) => s + (d.expenses?.length || 0), 0);
  const totalInc   = Object.values(allData).reduce((s, d) => s + (d.incomes?.length || 0), 0);

  return (
    <div className="page-settings">
      {/* File Status */}
      <div className="card">
        <h3>📁 Excel File Status</h3>
        <div className="file-status-grid">
          <div className={`fs-card ${fileConnected ? 'connected' : 'disconnected'}`}>
            <span className="fs-icon">{fileConnected ? '🟢' : '🔴'}</span>
            <div>
              <strong>{fileConnected ? 'Connected' : 'Not Connected'}</strong>
              <p>{fileConnected ? fileName : 'No file linked — data saved in browser only'}</p>
            </div>
          </div>
          <div className="fs-card">
            <span className="fs-icon">📊</span>
            <div><strong>{sheetCount} month tabs</strong><p>{totalExp} expenses · {totalInc} income entries</p></div>
          </div>
        </div>
        <div className="set-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-pri" onClick={handleOpenFile}>📂 Open File</button>
          <button className="btn btn-sec" onClick={handleDownload}>📥 Download Excel</button>
        </div>
        {!SUPPORTS_FS && (
          <div className="info-box warn" style={{ marginTop: 12 }}>
            ⚠️ Your browser doesn't support auto-save to file. Use Chrome or Edge for auto-sync.
            Data is saved in your browser (localStorage). Use "Download Excel" to export.
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="card">
        <h3>🔔 Notifications</h3>
        <p className="desc">Get reminded on the 13th to add utility costs.</p>
        <div className="set-section">
          <button className="btn btn-pri" onClick={reqNotif}>Enable Browser Notifications</button>
          <span className="notif-stat">
            Status: {typeof Notification !== 'undefined' ? Notification.permission : 'Not supported'}
          </span>
        </div>
      </div>

      {/* Data Management */}
      <div className="card">
        <h3>🗄️ Data Management</h3>
        <p className="desc">All data is also cached in localStorage as backup.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-danger" onClick={() => {
            if (window.confirm('Delete ALL data? Cannot undo.')) { localStorage.removeItem('bpro_data'); setAllData({}); }
          }}>🗑️ Clear All Data</button>
          <button className="btn btn-sec" onClick={() => {
            const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'budgetpro_backup.json'; a.click();
          }}>💾 Backup JSON</button>
          <label className="btn btn-sec" style={{ cursor: 'pointer' }}>
            📂 Restore JSON
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={e => {
              const file = e.target.files[0]; if (!file) return;
              const reader = new FileReader();
              reader.onload = ev => {
                try {
                  const d = JSON.parse(ev.target.result);
                  setAllData(d); save('bpro_data', d);
                  alert('Restored! Reloading...');
                } catch { alert('Invalid file.'); }
              };
              reader.readAsText(file);
            }} />
          </label>
        </div>
      </div>
    </div>
  );
}