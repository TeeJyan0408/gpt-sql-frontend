// src/App.js — v1.8.1
// Patches on v1.8.0: number formatting for table/axes/tooltips,
// safer chart axis resolution & try/catch guard (prevents black screen),
// ErrorBoundary wrapper, keep login modal & auth headers, CSV upload, etc.

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer
} from 'recharts';

const API_BASE = window.__API_BASE__ || process.env.REACT_APP_API_BASE || 'http://localhost:5000';
const COLORS = ['#3b82f6', '#f97316', '#10b981', '#ef4444', '#6366f1', '#eab308', '#22c55e', '#06b6d4', '#a855f7', '#f59e0b'];
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/* ───────── Theme (Tailwind dark mode via root class) ───────── */
function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  return { theme, setTheme };
}

/* ───────── Web Speech (voice input) ───────── */
function useSpeech() {
  const Rec = (typeof window !== 'undefined')
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

  const [supported, setSupported] = useState(Boolean(Rec));
  const [isRecording, setIsRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const [finalText, setFinalText] = useState('');
  const recRef = useRef(null);

  useEffect(() => {
    setSupported(Boolean(Rec));
    if (!Rec) return;
    const r = new Rec();
    r.lang = 'en-US';
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      let inter = '', fin = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) fin += res[0].transcript;
        else inter += res[0].transcript;
      }
      if (inter) setInterim(inter.trim());
      if (fin) setFinalText(prev => (prev + ' ' + fin).trim());
    };

    r.onstart = () => { setIsRecording(true); setInterim(''); setFinalText(''); };
    r.onend = () => { setIsRecording(false); };
    r.onerror = () => { setIsRecording(false); };

    recRef.current = r;
    return () => { try { r.abort(); } catch {} };
  }, []); // init once

  const start = () => { if (recRef.current && !isRecording) try { recRef.current.start(); } catch {} };
  const stop  = () => { if (recRef.current &&  isRecording) try { recRef.current.stop();  } catch {} };
  const toggle = () => (isRecording ? stop() : start());

  return { supported, isRecording, interim, finalText, start, stop, toggle, setFinalText, setInterim };
}

/* ───────── Helpers: numbers & time parsing ───────── */
const toNumber = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^\d.,-]/g, '').replace(/\s+/g, '').replace(/,/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
};

// Simple number guard used by formatters/components
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);


// Pretty number formatting (2 decimals max)
const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const formatNumber = (n) => {
  const x = toNumber(n);
  return Number.isFinite(x) ? nf.format(x) : String(n);
};

const MONTHS3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fullTo3 = (m) => {
  const idx = ['January','February','March','April','May','June','July','August','September','October','November','December']
    .findIndex(x => x.toLowerCase() === String(m).toLowerCase());
  return idx >= 0 ? MONTHS3[idx] : null;
};
const monthIndex = (s) => {
  if (typeof s !== 'string') return Number.POSITIVE_INFINITY;
  const t = s.trim();
  let m = t.match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (m) { const mi = MONTHS3.indexOf(m[1].slice(0,3)); return (parseInt(m[2],10)*12)+(mi>=0?mi:0); }
  m = t.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) { const abbr = fullTo3(m[1]) || m[1].slice(0,3); const mi = MONTHS3.indexOf(abbr); return (parseInt(m[2],10)*12)+(mi>=0?mi:0); }
  m = t.match(/^(\d{4})-(\d{2})$/); if (m) return (parseInt(m[1],10)*12)+(parseInt(m[2],10)-1);
  m = t.match(/^(\d{2})\/(\d{4})$/); if (m) return (parseInt(m[2],10)*12)+(parseInt(m[1],10)-1);
  m = t.match(/^(\d{4})$/); if (m) return parseInt(m[1],10)*12;
  return Number.POSITIVE_INFINITY;
};

const looksLikeTimeName = (name) => /(^|_)(month|date|period|quarter|year)s?($|_)/i.test(name);
const isTimeLikeAxis = (name, sampleValues = []) => {
  if (!name) return false;
  if (looksLikeTimeName(name)) return true;
  const toCheck = sampleValues.slice(0, 15);
  let parsed = 0;
  for (const v of toCheck) if (Number.isFinite(monthIndex(String(v ?? '')))) parsed++;
  return parsed >= Math.ceil((toCheck.length || 1) * 0.6);
};
const nameMatches = (name, patterns) => patterns.some(p => new RegExp(p, 'i').test(name));

/* ───────── Axis resolution & pivoting ───────── */
function resolveAxes(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { xKey: null, seriesKey: null, yKey: null, isMulti: false };
  }
  const sample = rows[0];
  const cols = Object.keys(sample || {});
  const isNum = (c) => Number.isFinite(toNumber(sample[c]));

  const numericCols    = cols.filter(isNum);
  const nonNumericCols = cols.filter(c => !isNum(c));

  // Prefer time for x
  const timeCandidates = ['^month$', 'month', 'date', 'period', 'quarter', '^year$'];
  let xKey = cols.find(c => nameMatches(c, timeCandidates));

  // Prefer region/branch for series, product category alternate
  const geoPrefs     = ['^region$', 'region', '^branch$', 'branch_name', 'city', 'country', 'location'];
  const productPrefs = ['^product_category$', 'product_category', '^category$', 'category', '^product$', 'model', 'product_name', 'product'];
  const geoCol     = cols.find(c => nameMatches(c, geoPrefs));
  const productCol = cols.find(c => nameMatches(c, productPrefs));

  if (!xKey) xKey = geoCol || nonNumericCols.find(c => looksLikeTimeName(c)) || nonNumericCols[0] || null;

  let seriesKey = null;
  if (xKey && productCol && productCol !== xKey) seriesKey = productCol;
  else if (xKey && geoCol && geoCol !== xKey)   seriesKey = geoCol;
  else seriesKey = nonNumericCols.find(c => c !== xKey) || null;

  const metricPref = ['revenue_rm', 'revenue', 'total_amount', 'price', 'sales', 'total', 'total_sales', 'quantity', 'qty', 'count'];
  let yKey = cols.find(c => metricPref.some(p => new RegExp(p, 'i').test(c)) && isNum(c));
  if (!yKey) yKey = numericCols[0] || null;

  // Only swap if x is NOT time-like AND series is a geo column
  const xLooksTime = isTimeLikeAxis(xKey, rows.slice(0, 20).map(r => r?.[xKey]));
  if (!xLooksTime && !nameMatches(xKey || '', geoPrefs) && nameMatches(seriesKey || '', geoPrefs)) {
    const tmp = xKey; xKey = seriesKey; seriesKey = tmp;
  }

  const isMulti = Boolean(xKey && seriesKey && yKey && xKey !== seriesKey && Number.isFinite(toNumber(sample[yKey])));
  return { xKey, seriesKey, yKey, isMulti };
}

function pivotData(rows, xKey, seriesKey, yKey) {
  const xSet = new Set();
  const seriesSet = new Set();
  const map = new Map();
  rows.forEach(r => {
    const x = r[xKey];
    const s = r[seriesKey];
    const v = toNumber(r[yKey]);
    if (!map.has(x)) map.set(x, { [xKey]: x });
    map.get(x)[s] = Number.isFinite(v) ? v : 0;
    xSet.add(x); seriesSet.add(s);
  });
  const xs = Array.from(xSet);
  xs.sort((a, b) => {
    const ia = monthIndex(String(a));
    const ib = monthIndex(String(b));
    if (Number.isFinite(ia) && Number.isFinite(ib)) return ia - ib;
    if (Number.isFinite(ia)) return -1;
    if (Number.isFinite(ib)) return 1;
    return String(a).localeCompare(String(b));
  });
  return { data: xs.map(x => map.get(x)), series: Array.from(seriesSet) };
}

/* ───────── Feedback UI ───────── */
function FeedbackButtons({ disabled, onUp, onDown }) {
  return (
    <div className="mt-2 flex items-center gap-2 text-sm">
      <button
        type="button"
        disabled={disabled}
        onClick={onUp}
        className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50
                   dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-100 disabled:opacity-50"
        title="Helpful"
      >
        👍
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onDown}
        className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50
                   dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-100 disabled:opacity-50"
        title="Not helpful"
      >
        👎
      </button>
    </div>
  );
}

/* ───────── Login Modal (NEW) ───────── */
function LoginModal({ open, onClose, onSuccess }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setStatus('');
    setLoading(true);
    try {
      const { data } = await axios.post(`${API_BASE}/auth/login`, { username, password });
      localStorage.setItem('auth_token_v180', data.token);
      setStatus('✅ Logged in');
      onSuccess?.(data.token);
      onClose?.();
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[999]">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div className="text-lg font-semibold dark:text-gray-100">Login required</div>
        <input className="w-full border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
               value={username} onChange={e=>setUsername(e.target.value)} placeholder="Username" />
        <input className="w-full border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
               type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" />
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose}
                  className="px-3 py-1 rounded border dark:border-gray-700 dark:text-gray-100">Cancel</button>
          <button type="submit" disabled={loading}
                  className="px-3 py-1 rounded bg-blue-600 text-white dark:bg-blue-500">{loading?'Logging in…':'Login'}</button>
        </div>
        {status && <div className="text-sm text-gray-600 dark:text-gray-300">{status}</div>}
      </form>
    </div>
  );
}

/* ───────── CSV Upload (uses token; can request login) ───────── */
function UploadCSV({ onUploaded, onRequireLogin }) {
  const [tenant, setTenant] = useState('');
  const [file, setFile] = useState(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e) => {
    e.preventDefault();
    setStatus('');
    if (!tenant || !/^[A-Za-z0-9_\-]{2,40}$/.test(tenant)) { setStatus('Please enter a valid tenant key (2-40 chars, letters/numbers/_/-)'); return; }
    if (!file) { setStatus('Please choose a .csv file'); return; }
    if (file && file.size > 25 * 1024 * 1024) { setStatus('File too large (>25MB). Please upload a smaller CSV.'); return; }
    if (file && file.type && !/text\/csv|application\/vnd\.ms-excel/.test(file.type)) { setStatus('File type does not look like CSV.'); return; }

    const fd = new FormData();
    fd.append('tenant', tenant);
    fd.append('table', 'sales');
    fd.append('file', file);

    try {
      setUploading(true);
      const token = localStorage.getItem('auth_token_v180');
      const res = await fetch(`${API_BASE}/tenants/upload-csv`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
        body: fd
      });
      if (res.status === 401) {
        setStatus('🔒 Login required');
        onRequireLogin?.();
        return;
      }
      const data = await res.json();
      if (res.ok) {
        setStatus(`✅ Uploaded: ${data.tenant}`);
        setFile(null);
        setTenant('');
        if (typeof onUploaded === 'function') onUploaded(data.tenant);
      } else {
        setStatus(`⚠️ ${data.error || 'Upload failed'}`);
      }
    } catch (err) {
      setStatus(`⚠️ ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-xs px-3 py-1 rounded border bg-gray-100 hover:bg-gray-200 border-gray-300
                   dark:bg-gray-800 dark:hover:bg-gray-700 dark:border-gray-700 dark:text-gray-100"
        title="Upload a CSV to create a new tenant DB"
      >
        {open ? 'Close Upload' : 'Upload CSV'}
      </button>

      {open && (
        <form onSubmit={handleUpload}
              className="absolute right-0 mt-2 w-80 z-10 rounded-xl border border-gray-200 bg-white p-3 shadow
                         dark:bg-gray-900 dark:border-gray-700">
          <div className="text-sm font-semibold mb-2 dark:text-gray-100">Create tenant from CSV</div>
          <label className="text-xs dark:text-gray-300">Tenant key</label>
          <input
            type="text"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            placeholder="e.g. cars"
            className="w-full mb-2 border border-gray-300 rounded px-2 py-1 text-sm
                       dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
          />
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full mb-2 text-sm dark:text-gray-200"
          />
          <button
            type="submit"
            disabled={uploading}
            className="w-full text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700
                       dark:bg-blue-500 dark:hover:bg-blue-600 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
          {status && <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">{status}</div>}
        </form>
      )}
    </div>
  );
}

/* ───────── Error Boundary (prevents black screens) ───────── */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('UI ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 m-4 rounded-lg border border-red-300 bg-red-50 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">
          <div className="font-semibold mb-1">Something went wrong while rendering.</div>
          <div className="text-sm break-all">{String(this.state.error)}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ───────── App ───────── */
export default function App() {
  const { theme, setTheme } = useTheme();
  const speech = useSpeech();

  const [query, setQuery] = useState('');
  const [conversation, setConversation] = useState([]);
  const [loading, setLoading] = useState(false);

  // Auth (NEW)
  const [showLogin, setShowLogin] = useState(false);
  const getToken = () => localStorage.getItem('auth_token_v180');

  // Attach token to axios when present
  useEffect(() => {
    const id = axios.interceptors.request.use((cfg) => {
      const t = getToken();
      if (t) cfg.headers = { ...(cfg.headers || {}), Authorization: `Bearer ${t}` };
      return cfg;
    });
    return () => axios.interceptors.request.eject(id);
  }, []);

  // Databases
  const [databases, setDatabases] = useState([]);
  const [selectedDb, setSelectedDb] = useState(() => localStorage.getItem('selected_db') || 'demo');

  // History (namespaced by DB)
  const historyKey = (db) => `nl_sql_history_v180_${db}`;
  const [history, setHistory] = useState(() => {
    const raw = localStorage.getItem(historyKey(selectedDb));
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  });
  const [historySearch, setHistorySearch] = useState('');

  const messagesEndRef = useRef(null);

  // Metrics
  const [showMetrics, setShowMetrics] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState('');

  // Fetch DB list
  const fetchDatabases = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/databases`);
      const dbs = data.databases || [];
      setDatabases(dbs);
      if (!dbs.includes(selectedDb)) {
        const def = dbs[0] || 'demo';
        setSelectedDb(def);
        localStorage.setItem('selected_db', def);
      }
    } catch {
      if (!selectedDb) {
        setSelectedDb('demo');
        localStorage.setItem('selected_db', 'demo');
      }
      setDatabases([selectedDb || 'demo']);
    }
  };

  useEffect(() => { fetchDatabases(); /* on mount */ }, []); // eslint-disable-line

  // After CSV upload → refresh DBs and auto-select new
  const handleUploadedTenant = async (tenantKey) => {
    await fetchDatabases();
    setSelectedDb(tenantKey);
    localStorage.setItem('selected_db', tenantKey);
  };

  // When DB changes: save selected, load that DB's history
  useEffect(() => {
    localStorage.setItem('selected_db', selectedDb);
    const raw = localStorage.getItem(historyKey(selectedDb));
    setHistory(() => {
      if (!raw) return [];
      try { return JSON.parse(raw); } catch { return []; }
    });
    // If switching to non-demo and no token → show login
    if (selectedDb.toLowerCase() !== 'demo' && !getToken()) {
      setShowLogin(true);
    }
  }, [selectedDb]);

  // Persist history for current DB
  useEffect(() => {
    localStorage.setItem(historyKey(selectedDb), JSON.stringify(history));
  }, [history, selectedDb]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [conversation]);

  // Voice hotkey: Ctrl/⌘ + Space
  useEffect(() => {
    const onKey = (e) => {
      const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const combo = (isMac ? e.metaKey : e.ctrlKey) && e.code === 'Space';
      if (combo) { e.preventDefault(); if (speech.supported) speech.toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [speech]);

  // Place final transcript into input
  useEffect(() => {
    if (speech.finalText) {
      setQuery(prev => (prev ? `${prev} ${speech.finalText}` : speech.finalText));
      speech.setFinalText('');
    }
  }, [speech.finalText]); // eslint-disable-line

  const addToHistory = (text) => {
    const t = text.trim();
    if (!t) return;
    setHistory(prev => [{ id: uid(), text: t, ts: Date.now() }, ...prev].slice(0, 200));
  };
  const rerunQuery = (text) => { setQuery(text); setTimeout(() => document.getElementById('nl-input')?.focus(), 0); };
  const deleteHistoryItem = (id) => setHistory(prev => prev.filter(h => h.id !== id));
  const clearHistory = () => setHistory([]);

  // Apply UI action to last bot result (chart type/color)
  function applyUiActionToLastResult(action) {
    setConversation(prev => {
      const idx = [...prev].reverse().findIndex(m => m.type === 'bot' && Array.isArray(m.results));
      if (idx === -1) {
        return [...prev, { id: uid(), type: 'bot', reply: 'Noted. I’ll apply that to your next chart.', feedback: null, meta: { db: selectedDb } }];
      }
      const target = prev.length - 1 - idx;
      const updated = [...prev];
      const msg = { ...updated[target] };
      if (action.chartType) msg.chartType = action.chartType;
      if (action.color)     msg.chartColor = action.color;
      updated[target] = msg;
      return updated;
    });
  }

  // Feedback
  async function sendFeedback(messageId, rating) {
    setConversation(prev => prev.map(m => m.id === messageId ? { ...m, feedback: rating === 1 ? 'up' : 'down' } : m));
    try {
      const msg = conversation.find(m => m.id === messageId);
      await axios.post(`${API_BASE}/feedback`, {
        messageId,
        rating,
        query: msg?.originalQuery || '',
        sql: msg?.sql || '',
        meta: msg?.meta || { db: selectedDb }
      });
    } catch {
      setConversation(prev => prev.map(m => m.id === messageId ? { ...m, feedback: null } : m));
    }
  }

  // Metrics
  const fetchMetrics = async () => {
    try {
      setMetricsError(''); setMetricsLoading(true);
      const { data } = await axios.get(`${API_BASE}/metrics/summary`);
      setMetrics(data);
    } catch (e) {
      setMetricsError(e?.response?.data?.error || e.message || 'Failed to load metrics');
    } finally {
      setMetricsLoading(false);
    }
  };

  const toggleMetrics = () => {
    setShowMetrics(v => {
      const next = !v;
      if (next && !metrics) fetchMetrics();
      return next;
    });
  };

  // Submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    // If protected DB and not logged in → prompt
    if (selectedDb.toLowerCase() !== 'demo' && !getToken()) {
      setShowLogin(true);
      return;
    }

    addToHistory(query);
    const toSend = query;
    setConversation(prev => [...prev, { id: uid(), type: 'user', content: toSend }]);
    setLoading(true);
    setQuery('');

    try {
      const res = await axios.post(`${API_BASE}/query`, { query: toSend, db: selectedDb });

      // UI action (theme/chart)
      if (res.data.action) {
        const action = res.data.action;
        if (action.theme) {
          const t = String(action.theme).toLowerCase();
          if (t === 'toggle') setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
          else if (t === 'dark' || t === 'light') setTheme(t);
        }
        if (action.chartType || action.color) applyUiActionToLastResult(action);
        return;
      }

      // Friendly reply
      if (res.data.reply) {
        setConversation(prev => [...prev, {
          id: uid(), type: 'bot', reply: res.data.reply, originalQuery: toSend, feedback: null, meta: res.data?.meta || { db: selectedDb }
        }]);
        return;
      }

      // SQL result
      const rows = res.data.results || [];
      setConversation(prev => [...prev, {
        id: uid(),
        type: 'bot',
        originalQuery: toSend,
        sql: res.data.sql,
        results: rows,
        chartType: 'bar',
        chartColor: '#3b82f6',
        view: 'both',
        chartTitle: res.data?.meta?.title || 'Chart',
        xLabel: res.data?.meta?.xLabel || '',
        yLabel: res.data?.meta?.yLabel || '',
        meta: res.data?.meta || { db: selectedDb },
        feedback: null
      }]);
    } catch (err) {
      const status = err?.response?.status;
      const error = err?.response?.data?.error || err.message || 'Something went wrong';
      const sql = err?.response?.data?.sql || null;
      if (status === 401) setShowLogin(true);
      setConversation(prev => [...prev, { id: uid(), type: 'bot', error, sql }]);
    } finally {
      setLoading(false);
      if (showMetrics) fetchMetrics();
    }
  };

  /* ───────── Chart Renderer ───────── */
  const renderChart = (data, xKey, yKey, type, color, xLabel, yLabel) => {
    try {
      const { xKey: rx, seriesKey, yKey: ry, isMulti } = resolveAxes(data);

      // Use explicit keys when provided, otherwise the auto-resolved ones
      const ex = xKey || rx;
      const ey = yKey || ry;

      // Guard AFTER fallback
      if (!ex || !ey) {
        return <div className="text-sm text-red-600">Unable to resolve chart axes from the result.</div>;
      }

      if (isMulti) {
        const { data: wide, series } = pivotData(data, ex, seriesKey, ey);
        const sampleX = wide.map(row => row[ex]);
        const timeLike = isTimeLikeAxis(ex, sampleX);

        // Prefer grouped BAR for time multi-series unless explicitly asked for a line
        if (timeLike && type !== 'line') {
          return (
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={wide} margin={{ bottom: 48, left: 56, right: 16, top: 8 }}>
                <XAxis
                  dataKey={ex}
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                  height={70}
                  tick={{ fontSize: 12 }}
                  label={xLabel ? { value: xLabel, position: 'insideBottom', offset: -36 } : undefined}
                />
                <YAxis tickMargin={8} width={80} tickFormatter={formatNumber}
                       label={yLabel ? { value: yLabel, angle: -90, position: 'left', dx: -12 } : undefined} />
                <Tooltip formatter={(v) => formatNumber(v)} />
                {series.map((s, i) => (
                  <Bar key={String(s)} dataKey={String(s)} fill={COLORS[i % COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          );
        }

        // Explicit line
        if (timeLike && type === 'line') {
          return (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={wide} margin={{ bottom: 64, left: 64, right: 24, top: 8 }}>
                <XAxis dataKey={ex} angle={-30} textAnchor="end" interval={0} height={70}
                       tick={{ fontSize: 12 }}
                       label={xLabel ? { value: xLabel, position: 'insideBottom', offset: -36 } : undefined} />
                <YAxis tickMargin={8} width={80} tickFormatter={formatNumber}
                       label={yLabel ? { value: yLabel, angle: -90, position: 'left', dx: -10 } : undefined} />
                <Tooltip formatter={(v) => formatNumber(v)} />
                {series.map((s, i) => (
                  <Line key={String(s)} type="monotone" dataKey={String(s)} stroke={COLORS[i % COLORS.length]} strokeWidth={2} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          );
        }

        // Categorical multi-series → grouped bars
        return (
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={wide} margin={{ bottom: 48, left: 56, right: 16, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={ex} angle={-20} textAnchor="end" interval={0}
                     label={xLabel ? { value: xLabel, position: 'insideBottom', offset: -28 } : undefined} />
              <YAxis tickMargin={8} tickFormatter={formatNumber}
                     label={yLabel ? { value: yLabel, angle: -90, position: 'left', dx: -10 } : undefined} />
              <Tooltip formatter={(v) => formatNumber(v)} />
              {series.map((s, i) => (
                <Bar key={String(s)} dataKey={String(s)} fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );
      }

      // Single-series
      switch (type) {
        case 'bar':
          return (
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={data} margin={{ bottom: 48, left: 56, right: 16, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={ex} angle={-30} textAnchor="end" interval={0} />
                <YAxis tickFormatter={formatNumber} />
                <Tooltip formatter={(v) => formatNumber(v)} />
                <Bar dataKey={ey} fill={color} />
              </BarChart>
            </ResponsiveContainer>
          );
        case 'line':
          return (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={data} margin={{ bottom: 48, left: 56, right: 16, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={ex} angle={-30} textAnchor="end" interval={0} />
                <YAxis tickFormatter={formatNumber} />
                <Tooltip formatter={(v) => formatNumber(v)} />
                <Line dataKey={ey} stroke={color} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          );
        case 'pie':
          return (
            <ResponsiveContainer width="100%" height={360}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey={ey}
                  nameKey={ex}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(e) => `${e.name}: ${formatNumber(e.value)}`}
                >
                  {data.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => formatNumber(v)} />
              </PieChart>
           </ResponsiveContainer>
          );
        default:
          return null;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Chart render error:', e);
      return <div className="text-sm text-red-600">Chart failed to render. Check console for details.</div>;
    }
  };

  const filteredHistory = history.filter(h =>
    !historySearch.trim() || h.text.toLowerCase().includes(historySearch.toLowerCase())
  );

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-100 p-0 flex dark:bg-gray-900">
        {/* Sidebar: History */}
        <aside className="w-72 max-w-72 bg-white border-r border-gray-200 p-4 hidden md:flex md:flex-col gap-3
                          dark:bg-gray-900 dark:border-gray-800">
          <div className="text-lg font-semibold dark:text-gray-100">History ({selectedDb})</div>
          <input
            type="text"
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
            placeholder="Search queries…"
            className="border border-gray-300 rounded px-3 py-2 text-sm
                       bg-white text-gray-900
                       dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
          />
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{filteredHistory.length} items</span>
            <button onClick={clearHistory} className="text-red-600 hover:underline">Clear All</button>
          </div>

          <div className="overflow-y-auto flex-1 pr-1">
            {filteredHistory.length === 0 ? (
              <div className="text-xs text-gray-500 mt-4 dark:text-gray-400">No history yet.</div>
            ) : (
              filteredHistory.map(h => (
                <div key={h.id} className="group border border-gray-200 rounded-md p-2 mb-2 hover:bg-gray-50
                                           dark:border-gray-800 dark:hover:bg-gray-800">
                  <button
                    className="text-left text-sm font-medium text-gray-800 w-[85%] truncate
                               dark:text-gray-100"
                    title={h.text}
                    onClick={() => rerunQuery(h.text)}
                  >
                    {h.text}
                  </button>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[11px] text-gray-400">{new Date(h.ts).toLocaleString()}</span>
                    <button className="text-[11px] text-red-600 opacity-0 group-hover:opacity-100" onClick={() => deleteHistoryItem(h.id)}>
                      delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 p-6 flex flex-col items-stretch">
          <div className="w-full max-w-[1400px] bg-white rounded-2xl shadow p-6 space-y-4 dark:bg-gray-900 dark:shadow-none mx-auto">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold dark:text-gray-100">🧠 GPT-to-SQL Assistant</h1>
              <div className="flex items-center gap-2">
                {/* DB selector */}
                <select
                  value={selectedDb}
                  onChange={(e) => setSelectedDb(e.target.value)}
                  className="text-xs px-2 py-1 rounded border bg-gray-100 hover:bg-gray-200 border-gray-300
                             dark:bg-gray-800 dark:hover:bg-gray-700 dark:border-gray-700 dark:text-gray-100"
                  title="Select database"
                >
                  {databases.map(db => <option key={db} value={db}>{db}</option>)}
                </select>

                {/* Auth controls (NEW) */}
                {selectedDb.toLowerCase() !== 'demo' ? (
                  getToken() ? (
                    <button
                      onClick={() => { localStorage.removeItem('auth_token_v180'); setShowLogin(true); }}
                      className="text-xs px-3 py-1 rounded border bg-gray-100 hover:bg-gray-200 border-gray-300
                                 dark:bg-gray-800 dark:hover:bg-gray-700 dark:border-gray-700 dark:text-gray-100">
                      Re-login
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowLogin(true)}
                      className="text-xs px-3 py-1 rounded border bg-gray-100 hover:bg-gray-200 border-gray-300
                                 dark:bg-gray-800 dark:hover:bg-gray-700 dark:border-gray-700 dark:text-gray-100">
                      Login
                    </button>
                  )
                ) : null}

                {/* CSV Upload (NEW) */}
                <UploadCSV onUploaded={handleUploadedTenant} onRequireLogin={() => setShowLogin(true)} />

                <span className={`text-xs px-2 py-1 rounded ${speech.isRecording ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                  {speech.supported ? (speech.isRecording ? 'Listening…' : 'Voice ready') : 'Voice N/A'}
                </span>
                <button
                  type="button"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="text-xs px-3 py-1 rounded border bg-gray-100 hover:bg-gray-200 border-gray-300
                             dark:bg-gray-800 dark:hover:bg-gray-700 dark:border-gray-700 dark:text-gray-100"
                >
                  {theme === 'dark' ? 'Light' : 'Dark'}
                </button>
                <button
                  type="button"
                  onClick={toggleMetrics}
                  className="text-xs px-3 py-1 rounded border bg-gray-100 hover:bg-gray-200 border-gray-300
                             dark:bg-gray-800 dark:hover:bg-gray-700 dark:border-gray-700 dark:text-gray-100"
                >
                  {showMetrics ? 'Hide Metrics' : 'Show Metrics'}
                </button>
              </div>
            </div>

            {/* Metrics widget */}
            {showMetrics && (
              <div className="rounded-xl border border-gray-200 p-4 bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold dark:text-gray-100">Metrics</h2>
                  {metricsLoading && <span className="text-xs text-gray-500 dark:text-gray-400">Loading…</span>}
                </div>
                {metricsError ? (
                  <div className="text-sm text-red-600">{metricsError}</div>
                ) : !metrics ? (
                  <div className="text-sm text-gray-600 dark:text-gray-300">No data yet. Click “Show Metrics”.</div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Stat title="Total events" value={metrics.total_events} />
                      <Stat title="SQL attempts" value={metrics.sql_attempts} />
                      <Stat title="SQL success" value={metrics.sql_success} />
                      <Stat title="Success rate" value={`${metrics.sql_success_rate_pct}%`} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                      <Stat title="Avg exec time (success)" value={metrics.avg_exec_ms_success == null ? '—' : `${Math.round(metrics.avg_exec_ms_success)} ms`} />
                      <div className="rounded-lg p-3 bg-white border border-gray-200 dark:bg-gray-900 dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Type breakdown</div>
                        {metrics.type_breakdown && Object.keys(metrics.type_breakdown).length ? (
                          <ul className="text-sm dark:text-gray-100">
                            {Object.entries(metrics.type_breakdown).map(([k, v]) => (
                              <li key={k} className="flex justify-between">
                                <span className="capitalize">{k}</span>
                                <span className="font-medium">{v}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (<div className="text-sm text-gray-500 dark:text-gray-400">No data</div>)}
                      </div>
                    </div>
                    {metrics.per_db && Object.keys(metrics.per_db).length > 0 && (
                      <div className="rounded-lg p-3 bg-white border border-gray-200 mt-3 dark:bg-gray-900 dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Per DB</div>
                        <ul className="text-sm dark:text-gray-100">
                          {Object.entries(metrics.per_db).map(([db, d]) => (
                            <li key={db} className="flex justify-between">
                              <span>{db}</span>
                              <span>{d.sql_success}/{d.sql_attempts} success</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Conversation */}
            <div className="max-h-[60vh] overflow-y-auto space-y-4">
              {conversation.map((msg, i) => (
                <div key={msg.id || i} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`${msg.type === 'user' ? 'max-w-[80%]' : 'w-full'} p-4 rounded-2xl shadow ${
                    msg.type === 'user'
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : 'bg-gray-100 text-gray-900 rounded-bl-none dark:bg-gray-800 dark:text-gray-100'
                  }`}>

                    {msg.type === 'user' ? (
                      <div><strong>You:</strong> {msg.content}</div>
                    ) : msg.error ? (
                      <>
                        <div className="text-red-500"><strong>⚠️ Error:</strong> {msg.error}</div>
                        {msg.sql && (
                          <>
                            <div className="text-xs text-gray-500 mt-2 dark:text-gray-400">SQL (attempted):</div>
                            <pre className="bg-white p-2 rounded text-xs overflow-x-auto dark:bg-gray-900 dark:border dark:border-gray-800">
                              {msg.sql}
                            </pre>
                          </>
                        )}
                      </>
                    ) : msg.reply ? (
                      <>
                        <div><strong>🤖:</strong> {msg.reply}</div>
                        <FeedbackRow msg={msg} onUp={() => sendFeedback(msg.id, 1)} onDown={() => sendFeedback(msg.id, -1)} />
                      </>
                    ) : (
                      <div>
                        <div className="text-xs text-gray-500 mb-1 dark:text-gray-400">🤖 SQL:</div>
                        <pre className="bg-white p-2 rounded text-xs overflow-x-auto dark:bg-gray-900 dark:border dark:border-gray-800">
                          {msg.sql}
                        </pre>

                        {(!msg.results || msg.results.length === 0) ? (
                          <p className="text-sm italic text-gray-500 dark:text-gray-400">No results found.</p>
                        ) : (
                          <>
                            <div className="w-full overflow-x-auto">
                              <table className="min-w-full text-sm mt-2 border border-black dark:border-gray-700 dark:text-gray-100">
                                <thead className="sticky top-0 z-10">
                                  <tr>
                                    {Object.keys(msg.results[0]).map((col, idx) => (
                                      <th
                                        key={idx}
                                        className="border border-black px-2 py-1 bg-gray-100 dark:bg-gray-800 dark:border-gray-700"
                                      >
                                        {col === 'name' ? 'Product' :
                                        col === 'revenue' ? 'Revenue (RM)' :
                                        col === 'total_sales' ? 'Quantity Sold' :
                                        col === 'branch_name' ? 'Branch' :
                                        col === 'region' ? 'Region' :
                                        col}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {msg.results.map((row, rowIdx) => (
                                    <tr key={rowIdx}>
                                      {Object.entries(row).map(([key, val], colIdx) => (
                                        <td
                                          key={colIdx}
                                          className="border border-black px-2 py-1 dark:border-gray-700"
                                        >
                                          {Number.isFinite(toNumber(val)) ? formatNumber(val) : String(val)}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {msg.chartTitle && (
                              <div className="mt-4 text-center font-semibold dark:text-gray-100">{msg.chartTitle}</div>
                            )}

                            <div className="mt-2" key={`chart-${msg.id || i}`}>
                              {renderChart(
                                msg.results,
                                Object.keys(msg.results[0])[0],
                                Object.keys(msg.results[0])[1],
                                msg.chartType || 'bar',
                                msg.chartColor || '#3b82f6',
                                msg.xLabel || '',
                                msg.yLabel || ''
                              )}
                            </div>

                            <FeedbackRow msg={msg} onUp={() => sendFeedback(msg.id, 1)} onDown={() => sendFeedback(msg.id, -1)} />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && <div className="text-center text-gray-600 italic dark:text-gray-300">🤖 GPT is thinking...</div>}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="flex gap-2 pt-2 items-center">
              <div className="relative flex-1">
                <input
                  id="nl-input"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={loading}
                  placeholder={speech.isRecording && speech.interim ? `🎤 ${speech.interim}` : "Ask: 'revenue per month by branch', 'sales by category', 'switch to dark mode'"}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 pr-10
                             bg-white text-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 disabled:opacity-60"
                />
                {/* Mic button */}
                <button
                  type="button"
                  onClick={speech.supported ? speech.toggle : undefined}
                  disabled={!speech.supported}
                  title={speech.supported ? (speech.isRecording ? 'Stop voice (Ctrl/⌘+Space)' : 'Start voice (Ctrl/⌘+Space)') : 'Web Speech not supported'}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-sm rounded
                    ${speech.supported
                      ? (speech.isRecording
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100')
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-gray-700'}`}
                >
                  {speech.isRecording ? '■' : '🎤'}
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700
                           dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {loading ? 'Thinking...' : 'Ask GPT'}
              </button>
            </form>
          </div>
        </main>

        {/* Login Modal (NEW) */}
        <LoginModal open={showLogin} onClose={() => setShowLogin(false)} onSuccess={() => setShowLogin(false)} />
      </div>
    </ErrorBoundary>
  );
}

/* ───────── Small presentational helpers ───────── */
function Stat({ title, value }) {
  return (
    <div className="rounded-lg p-3 bg-white border border-gray-200 dark:bg-gray-900 dark:border-gray-700">
      <div className="text-xs text-gray-500 dark:text-gray-400">{title}</div>
      <div className="text-xl font-semibold dark:text-gray-100">{value}</div>
    </div>
  );
}

function FeedbackRow({ msg, onUp, onDown }) {
  return (
    <div className="flex items-center justify-between mt-3">
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {msg.feedback ? (msg.feedback === 'up' ? 'Thanks for the feedback! 👍' : 'Thanks for the feedback! 👎') : 'Was this helpful?'}
      </span>
      <FeedbackButtons disabled={!!msg.feedback} onUp={onUp} onDown={onDown} />
    </div>
  );
}
