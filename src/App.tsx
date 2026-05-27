import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Login } from './Login';
import {
  Plus, Trash2, Download, Settings, History, Zap, CheckCircle, CheckCircle2,
  AlertCircle, ExternalLink, Youtube, Facebook, Instagram, Menu, X, Smartphone,
  Monitor, Clock, Sparkles, TrendingUp, Hash, PlaySquare, LogOut, ChevronRight,
  Activity, Radio, LayoutDashboard, CalendarClock, Brain, Eye, Globe, BarChart3,
  Link as LinkIcon, Copy, Check, List, Layers, Scissors, Upload, RefreshCcw,
  BookMarked, ChevronDown, ChevronUp, Flame, Target, Wand2, FileText, Sliders,
  ArrowUpRight, PieChart, PlayCircle, Pause, SkipBack, SkipForward, Volume2,
} from 'lucide-react';
import { generateViralClips, type ClipMetadata } from './services/geminiService';
import { SettingsModal } from './SettingsModal';
import { LicenseScreen } from './LicenseScreen';

// ─── Utilities ────────────────────────────────────────────────────────────────
function getYouTubeId(url: string) {
  const r = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/.exec(url);
  return (r && r[2].length === 11) ? r[2] : null;
}

function fmtSeconds(s: number) {
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatCount(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ─── Types ────────────────────────────────────────────────────────────────────
type TabId = 'dashboard' | 'autopilot' | 'scheduler' | 'history' | 'analytics';

interface Preset {
  id: string; name: string; format: 'portrait' | 'landscape';
  count: number; quality: string; useSubtitles: boolean;
  captionStyle: 'normal' | 'tiktok'; videoMode: 'reframe' | 'center' | 'split';
}

interface BulkUrl { id: string; url: string; status: 'idle' | 'processing' | 'done' | 'error'; clipsCount?: number; }

// ─── Default Presets ──────────────────────────────────────────────────────────
const DEFAULT_PRESETS: Preset[] = [
  { id: 'tiktok-viral', name: '🔥 TikTok Viral', format: 'portrait', count: 8, quality: '720p', useSubtitles: true, captionStyle: 'tiktok', videoMode: 'reframe' },
  { id: 'shorts-pro', name: '▶️ YouTube Shorts', format: 'portrait', count: 4, quality: '1080p', useSubtitles: false, captionStyle: 'normal', videoMode: 'reframe' },
  { id: 'reels-ig', name: '📸 Instagram Reels', format: 'portrait', count: 6, quality: '720p', useSubtitles: true, captionStyle: 'tiktok', videoMode: 'center' },
  { id: 'fb-video', name: '👥 Facebook Video', format: 'landscape', count: 4, quality: '720p', useSubtitles: false, captionStyle: 'normal', videoMode: 'center' },
];

// ─── Nav items ────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'dashboard' as TabId,  label: 'Dashboard',       icon: <LayoutDashboard size={16} />, badge: null },
  { id: 'autopilot' as TabId,  label: 'Channel Watcher', icon: <Radio size={16} />,           badge: 'AUTO' },
  { id: 'scheduler' as TabId,  label: 'Scheduler Queue', icon: <CalendarClock size={16} />,   badge: null },
  { id: 'analytics' as TabId,  label: 'Analytics',       icon: <PieChart size={16} />,        badge: 'NEW' },
  { id: 'history' as TabId,    label: 'Activity Log',    icon: <History size={16} />,         badge: null },
];

// ─── Caption Templates ────────────────────────────────────────────────────────
function buildCaption(clip: ClipMetadata, platform: string): string {
  const tags = clip.tags.slice(0, 8).join(' ');
  const hook = clip.hook;
  const desc = clip.description;

  switch (platform) {
    case 'tiktok':
      return `${hook}\n\n${desc}\n\n${tags}\n\n#fyp #viral #trending`;
    case 'youtube':
      return `${hook}\n\n${desc}\n\n📌 Subscribe for more viral content!\n\n${tags}`;
    case 'instagram':
      return `${hook} ✨\n\n${desc}\n\n.\n.\n.\n${tags} #reels #explore #viral`;
    case 'facebook':
      return `${hook}\n\n${desc}\n\n👍 Like & Share jika bermanfaat!\n${tags}`;
    default:
      return `${hook}\n\n${desc}\n\n${tags}`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  // ── Core state ──
  const [url, setUrl]               = useState(() => sessionStorage.getItem('viralclip_url') || '');
  const [format, setFormat]         = useState<'portrait' | 'landscape'>('portrait');
  const [count, setCount]           = useState<number>(4);
  const [quality, setQuality]       = useState('720p');
  const [useSubtitles, setUseSubtitles]   = useState(false);
  const [captionStyle, setCaptionStyle]   = useState<'normal' | 'tiktok'>('normal');
  const [subFontName, setSubFontName]     = useState('Impact');
  const [subFontSize, setSubFontSize]     = useState(48);
  const [subHighlightColor, setSubHighlightColor] = useState('yellow');
  const [videoMode, setVideoMode]         = useState<'reframe' | 'center' | 'split'>('reframe');

  // ── Manual Clip Maker state ──
  const [manualTitle, setManualTitle]             = useState('');
  const [manualHook, setManualHook]               = useState('');
  const [manualDescription, setManualDescription]   = useState('');
  const [manualTags, setManualTags]               = useState('');
  const [manualStart, setManualStart]             = useState<number>(0);
  const [manualEnd, setManualEnd]                 = useState<number>(30);

  // ── Transcript Editor state ──
  const [editTranscriptMode, setEditTranscriptMode]   = useState(false);
  const [editableTranscript, setEditableTranscript]   = useState('');
  const [isTranscriptFetched, setIsTranscriptFetched] = useState(false);
  const [fetchedVideoInfo, setFetchedVideoInfo]       = useState<any>(null);
  const [isFetchingTranscript, setIsFetchingTranscript] = useState(false);
  const [isGenerating, setIsGenerating]   = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab]   = useState<TabId>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [clips, setClips]           = useState<ClipMetadata[]>(() => {
    const s = sessionStorage.getItem('viralclip_clips');
    return s ? JSON.parse(s) : [];
  });
  const [error, setError]           = useState<string | null>(null);

  // ── Server/API state ──
  const [isYoutubeConnected, setIsYoutubeConnected] = useState(false);
  const [historyData, setHistoryData]   = useState<any[]>([]);
  const [scheduledJobs, setScheduledJobs] = useState<any[]>([]);
  const [watchedChannels, setWatchedChannels] = useState<string[]>([]);
  const [newChannelId, setNewChannelId] = useState('');
  const [watcherStatus, setWatcherStatus] = useState<any>({ isChecking: false, logs: [] });
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' | 'info' }[]>([]);

  // ── New features state ──
  const [presets, setPresets] = useState<Preset[]>(() => {
    const s = localStorage.getItem('viralclip_presets');
    return s ? JSON.parse(s) : DEFAULT_PRESETS;
  });
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkUrls, setBulkUrls] = useState<BulkUrl[]>([]);
  const [bulkInput, setBulkInput] = useState('');
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // ── Auth state ──
  const [token, setToken]     = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser]       = useState<any>(JSON.parse(localStorage.getItem('user') || 'null'));
  const [isLicensed, setIsLicensed]         = useState(false);
  const [checkingLicense, setCheckingLicense] = useState(true);

  // ── Persistence ──
  useEffect(() => { sessionStorage.setItem('viralclip_clips', JSON.stringify(clips)); }, [clips]);
  useEffect(() => { sessionStorage.setItem('viralclip_url', url); }, [url]);
  useEffect(() => { localStorage.setItem('viralclip_presets', JSON.stringify(presets)); }, [presets]);
  useEffect(() => { checkLicense(); }, []);

  // ─── Auth helpers ────────────────────────────────────────────────────────
  const checkLicense = async () => {
    try {
      const res = await fetch('/api/license/status');
      const data = await res.json();
      setIsLicensed(!!data.valid);
    } catch { setIsLicensed(false); } finally { setCheckingLicense(false); }
  };

  const handleLogin = (newToken: string, newUser: any) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken); setUser(newUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('token'); localStorage.removeItem('user');
    setToken(null); setUser(null);
  };

  const authedFetch = useCallback(async (url: string, options: any = {}) => {
    if (!token) return null;
    const headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) { handleLogout(); return null; }
    return res;
  }, [token]);

  // ─── Toast ────────────────────────────────────────────────────────────────
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  // ─── API fetchers ─────────────────────────────────────────────────────────
  const fetchScheduledJobs = async () => {
    try { const r = await authedFetch('/api/scheduler/list'); if (r?.ok) setScheduledJobs(await r.json()); }
    catch {}
  };
  const fetchHistory = async () => {
    try { const r = await authedFetch('/api/history'); if (r?.ok) setHistoryData(await r.json()); }
    catch {}
  };
  const fetchWatchedChannels = async () => {
    try { const r = await authedFetch('/api/v2/watcher/list'); if (r?.ok) setWatchedChannels(await r.json()); }
    catch {}
  };
  const fetchStatus = async () => {
    try { const r = await authedFetch('/api/v2/watcher/status'); if (r) setWatcherStatus(await r.json()); }
    catch {}
  };

  useEffect(() => {
    if (!token) return;
    authedFetch('/api/auth/status').then(r => r?.json()).then(d => { if (d) setIsYoutubeConnected(d.connected); }).catch(() => {});
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'youtube') { setIsYoutubeConnected(true); window.history.replaceState({}, '', window.location.pathname); }
    fetchHistory(); fetchWatchedChannels(); fetchStatus(); fetchScheduledJobs();
    const iv = setInterval(() => { fetchHistory(); fetchStatus(); fetchScheduledJobs(); }, 6000);
    return () => clearInterval(iv);
  }, [token]);

  // ─── Generate clips ───────────────────────────────────────────────────────
  const handleFetchTranscriptAndInfo = async () => {
    if (!url) return;
    setError(null);
    setIsFetchingTranscript(true);
    setIsTranscriptFetched(false);
    setFetchedVideoInfo(null);
    setEditableTranscript('');
    try {
      const res = await authedFetch(`/api/video-info?url=${encodeURIComponent(url)}`);
      if (!res) return;
      if (!res.ok) throw new Error('Gagal mengambil informasi video');
      const videoInfo = await res.json();
      setFetchedVideoInfo(videoInfo);

      const tRes = await authedFetch(`/api/transcript?url=${encodeURIComponent(url)}`);
      let transcript = '';
      if (tRes?.ok) { const td = await tRes.json(); transcript = td.transcript; }
      
      setEditableTranscript(transcript);
      setIsTranscriptFetched(true);
      showToast('Transkrip & info video berhasil diambil!', 'success');
    } catch (err: any) {
      setError(err.message || 'Gagal mengambil transkrip.');
      showToast(err.message || 'Gagal mengambil transkrip', 'error');
    } finally {
      setIsFetchingTranscript(false);
    }
  };

  const handleGenerateWithEditedTranscript = async () => {
    if (!url) return;
    setError(null);
    setIsGenerating(true);
    setClips([]);
    try {
      const results = await generateViralClips(url, format, fetchedVideoInfo, editableTranscript, count);
      setClips(results);
      showToast(`✅ ${results.length} klip berhasil digenerate!`, 'success');
    } catch (err: any) {
      setError(err.message || 'Gagal menghasilkan klip.');
      showToast(err.message || 'Generate gagal', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    
    if (editTranscriptMode) {
      await handleFetchTranscriptAndInfo();
      return;
    }

    setError(null); setIsGenerating(true); setClips([]);
    try {
      const res = await authedFetch(`/api/video-info?url=${encodeURIComponent(url)}`);
      if (!res) return;
      if (!res.ok) throw new Error('Gagal mengambil informasi video');
      const videoInfo = await res.json();
      const tRes = await authedFetch(`/api/transcript?url=${encodeURIComponent(url)}`);
      let transcript = '';
      if (tRes?.ok) { const td = await tRes.json(); transcript = td.transcript; }
      const results = await generateViralClips(url, format, videoInfo, transcript, count);
      setClips(results);
      showToast(`✅ ${results.length} klip berhasil digenerate!`, 'success');
    } catch (err: any) {
      setError(err.message || 'Gagal menghasilkan klip.');
      showToast(err.message || 'Generate gagal', 'error');
    } finally { setIsGenerating(false); }
  };

  // ─── Bulk process ─────────────────────────────────────────────────────────
  const handleAddBulkUrls = () => {
    const lines = bulkInput.split('\n').map(l => l.trim()).filter(Boolean);
    const newItems: BulkUrl[] = lines.map(u => ({ id: Date.now() + Math.random() + '', url: u, status: 'idle' }));
    setBulkUrls(prev => [...prev, ...newItems]);
    setBulkInput('');
    showToast(`${newItems.length} URL ditambahkan ke antrean`, 'info');
  };

  const handleBulkProcess = async () => {
    setIsBulkProcessing(true);
    const pending = bulkUrls.filter(u => u.status === 'idle');
    for (const item of pending) {
      setBulkUrls(prev => prev.map(u => u.id === item.id ? { ...u, status: 'processing' } : u));
      try {
        const res = await authedFetch(`/api/video-info?url=${encodeURIComponent(item.url)}`);
        const videoInfo = res?.ok ? await res.json() : {};
        const tRes = await authedFetch(`/api/transcript?url=${encodeURIComponent(item.url)}`);
        const transcript = tRes?.ok ? (await tRes.json()).transcript : '';
        const clips = await generateViralClips(item.url, format, videoInfo, transcript, count);
        setBulkUrls(prev => prev.map(u => u.id === item.id ? { ...u, status: 'done', clipsCount: clips.length } : u));
        setClips(prev => [...prev, ...clips]);
      } catch {
        setBulkUrls(prev => prev.map(u => u.id === item.id ? { ...u, status: 'error' } : u));
      }
      await new Promise(r => setTimeout(r, 800)); // brief pause
    }
    setIsBulkProcessing(false);
    showToast('Bulk processing selesai!', 'success');
  };

  // ─── Manual Clip Maker handler ──────────────────────────────────────────────
  const handleAddManualClip = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) { showToast('Masukkan URL video terlebih dahulu', 'error'); return; }
    const startSec = Number(manualStart);
    const endSec = Number(manualEnd);
    if (isNaN(startSec) || isNaN(endSec) || startSec < 0 || endSec <= startSec) {
      showToast('Waktu Mulai/Selesai tidak valid', 'error');
      return;
    }
    const parsedTags = manualTags
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
      .map(t => t.startsWith('#') ? t : `#${t}`);

    const newClip: ClipMetadata = {
      title: manualTitle.trim() || `Manual Clip #${clips.length + 1}`,
      hook: manualHook.trim() || 'Custom Hook Moment 🎣',
      description: manualDescription.trim() || 'Deskripsi klip kustom',
      tags: parsedTags.length > 0 ? parsedTags : ['#shorts', '#viral'],
      viralScore: 95, // high default score since user selected it manually
      timestamps: `${fmtSeconds(startSec)} - ${fmtSeconds(endSec)}`,
      aspectRatio: format,
      startTimeSeconds: startSec,
      endTimeSeconds: endSec,
      viralAnalysis: 'Klip ini dibuat secara manual oleh pengguna menggunakan Manual Clip Maker.'
    };
    setClips(prev => [newClip, ...prev]);
    
    // reset manual fields
    setManualTitle('');
    setManualHook('');
    setManualDescription('');
    setManualTags('');
    setManualStart(0);
    setManualEnd(30);
    showToast('Klip kustom berhasil ditambahkan!', 'success');
  };

  // ─── Preset manager ────────────────────────────────────────────────────────
  const applyPreset = (p: Preset) => {
    setFormat(p.format); setCount(p.count); setQuality(p.quality);
    setUseSubtitles(p.useSubtitles); setCaptionStyle(p.captionStyle); setVideoMode(p.videoMode);
    setActivePresetId(p.id);
    showToast(`Preset "${p.name}" diterapkan`, 'success');
  };

  const saveCurrentAsPreset = () => {
    const name = prompt('Nama preset baru:');
    if (!name) return;
    const newPreset: Preset = {
      id: Date.now().toString(), name,
      format, count, quality, useSubtitles, captionStyle, videoMode
    };
    setPresets(prev => [...prev, newPreset]);
    setActivePresetId(newPreset.id);
    showToast(`Preset "${name}" disimpan!`, 'success');
  };

  const deletePreset = (id: string) => {
    if (DEFAULT_PRESETS.find(p => p.id === id)) { showToast('Preset default tidak bisa dihapus', 'error'); return; }
    setPresets(prev => prev.filter(p => p.id !== id));
    if (activePresetId === id) setActivePresetId(null);
  };

  // ─── YouTube connect / watcher ─────────────────────────────────────────────
  const handleConnectYoutube = async () => {
    try {
      const res = await authedFetch('/api/auth/youtube');
      if (!res) return;
      const data = await res.json();
      if (!res.ok && data.error) { showToast(data.error, 'error'); return; }
      if (data.url) window.location.href = data.url;
    } catch { showToast('Gagal terhubung ke YouTube', 'error'); }
  };

  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelId) return;
    try {
      await authedFetch('/api/v2/watcher/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: newChannelId })
      });
      setNewChannelId(''); fetchWatchedChannels();
      showToast('Channel berhasil ditambahkan!', 'success');
    } catch {}
  };

  const handleRemoveChannel = async (id: string) => {
    try {
      await authedFetch('/api/v2/watcher/remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: id })
      });
      fetchWatchedChannels();
    } catch {}
  };

  const handleRunWatcher = async () => {
    showToast('Triggering watcher...', 'info');
    try {
      const res = await authedFetch('/api/v2/watcher/run', { method: 'POST' });
      if (res?.ok) { showToast('Watcher dipicu!', 'success'); fetchStatus(); }
      else showToast('Watcher sudah berjalan atau error.', 'error');
    } catch { showToast('Gagal memicu watcher.', 'error'); }
  };

  const handleCancelSchedule = async (id: string) => {
    if (!confirm('Batalkan jadwal postingan ini?')) return;
    try {
      const res = await authedFetch('/api/scheduler/remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
      });
      if (res?.ok) { showToast('Jadwal dibatalkan!', 'success'); fetchScheduledJobs(); }
      else showToast('Gagal membatalkan jadwal', 'error');
    } catch {}
  };

  // ── Computed stats ──
  const successCount  = historyData.filter(h => h.status === 'success').length;
  const pendingJobs   = scheduledJobs.filter(j => j.status === 'pending').length;
  const totalClipsGenerated = historyData.filter(h => h.type === 'export' || h.type === 'download').length + clips.length;

  // ── Guard screens ──
  if (checkingLicense) return (
    <div className="flex items-center justify-center h-screen" style={{ background: '#080b14' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#6366f1,#7c3aed)', boxShadow: '0 8px 32px rgba(99,102,241,0.5)' }}>
          <Zap size={28} fill="white" className="text-white" />
        </div>
        <div className="spinner" style={{ width: 28, height: 28, borderTopColor: '#818cf8' }} />
        <p className="text-slate-500 text-sm">Memeriksa lisensi...</p>
      </div>
    </div>
  );

  if (!isLicensed) return <LicenseScreen onSuccess={() => setIsLicensed(true)} />;
  if (!token) return <Login onLogin={handleLogin} />;

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="app-layout" style={{ background: '#080b14' }}>
      <div className="orb-1" /><div className="orb-2" />

      {/* ── Toast ── */}
      <div className="fixed top-5 right-5 z-[300] flex flex-col gap-3">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id} initial={{ opacity: 0, x: 50, scale: 0.88 }}
              animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 50, scale: 0.88 }}
              transition={{ duration: 0.22, ease: [0.23,1,0.32,1] }}
              className={`toast ${t.type === 'error' ? 'toast-error' : t.type === 'success' ? 'toast-success' : 'toast-info'}`}>
              {t.type === 'error' ? <AlertCircle size={15} /> : t.type === 'success' ? <CheckCircle size={15} /> : <Zap size={15} />}
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ── Mobile sidebar backdrop ── */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 lg:hidden"
            style={{ background: 'rgba(4,7,18,0.88)', backdropFilter: 'blur(10px)' }}
            onClick={() => setIsSidebarOpen(false)} />
        )}
      </AnimatePresence>

      {/* ══════════════════════ SIDEBAR ══════════════════════ */}
      <aside
        className={`sidebar ${isSidebarOpen ? 'open' : 'closed'} lg:relative lg:translate-x-0 flex flex-col`}
        style={{ background: 'rgba(5,8,20,0.97)', borderRight: '1px solid rgba(99,102,241,0.1)', backdropFilter: 'blur(24px)' }}
      >
        {/* Logo */}
        <div className="flex items-center justify-between p-5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center logo-icon"
              style={{ background: 'linear-gradient(135deg,#6366f1,#7c3aed)', boxShadow: '0 4px 18px rgba(99,102,241,0.45)' }}>
              <Zap size={19} fill="white" className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-bold text-white" style={{ fontSize: 15, fontFamily: "'Space Grotesk',sans-serif", letterSpacing: '-0.3px' }}>
                  ViralClip
                </h1>
                {/* @ts-ignore */}
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)' }}>v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0'}</span>
              </div>
              <p style={{ fontSize: 9.5, fontWeight: 700, color: '#6366f1', letterSpacing: '0.08em', textTransform: 'uppercase' }}>AI • AUTOPILOT</p>
            </div>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-500 hover:text-white p-1.5 rounded-lg" style={{ background: 'rgba(99,102,241,0.08)' }}>
            <X size={15} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3.5 space-y-1.5 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <button key={item.id} onClick={() => { setActiveTab(item.id); setIsSidebarOpen(false); }}
              className={`nav-item ${activeTab === item.id ? 'active' : ''}`} id={`nav-${item.id}`}>
              <span style={{ opacity: activeTab === item.id ? 1 : 0.45 }}>{item.icon}</span>
              <span className="flex-1" style={{ fontSize: 13.5 }}>{item.label}</span>
              {item.badge && <span className={`badge ${item.badge === 'NEW' ? 'badge-green' : 'badge-blue'}`} style={{ fontSize: 9.5, padding: '2px 7px' }}>{item.badge}</span>}
              {activeTab === item.id && <ChevronRight size={13} className="text-indigo-400 flex-shrink-0" />}
            </button>
          ))}

          <div className="pt-2 mt-2 divider" />
          <button onClick={() => { setIsSettingsOpen(true); setIsSidebarOpen(false); }}
            className="nav-item" id="nav-settings">
            <span style={{ opacity: 0.45 }}><Settings size={16} /></span>
            <span style={{ fontSize: 13.5 }}>API Settings</span>
          </button>
        </nav>

        {/* Mini stats */}
        <div className="mx-3.5 mb-3.5 p-4 rounded-2xl" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.13)' }}>
          <p className="text-label text-slate-600 mb-3" style={{ fontSize: 10 }}>Quick Stats</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { v: formatCount(successCount), l: 'Published' },
              { v: formatCount(pendingJobs), l: 'Queued' },
              { v: formatCount(watchedChannels.length), l: 'Channels' },
            ].map(s => (
              <div key={s.l}>
                <p className="text-white font-bold" style={{ fontSize: 17, fontFamily: "'Space Grotesk',sans-serif" }}>{s.v}</p>
                <p className="text-slate-600 font-semibold" style={{ fontSize: 10 }}>{s.l}</p>
              </div>
            ))}
          </div>
        </div>

        {/* User */}
        <div className="p-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.28),rgba(139,92,246,0.18))', border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8' }}>
              {user?.email?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-slate-300 font-semibold truncate" style={{ fontSize: 13 }}>{user?.email || 'User'}</p>
              <p className="text-slate-600 font-medium" style={{ fontSize: 10.5 }}>Licensed ✓</p>
            </div>
          </div>
          <button onClick={handleLogout} className="btn-danger w-full" style={{ fontSize: 12.5, padding: '9px 12px', borderRadius: 10 }}>
            <LogOut size={13} /> Logout
          </button>
        </div>
      </aside>

      {/* ══════════════════════ MAIN ══════════════════════ */}
      <main className="main-area relative z-10">
        {/* Header */}
        <header className="flex-shrink-0 flex items-center justify-between"
          style={{ padding: '0 24px', height: 64, background: 'rgba(5,8,20,0.85)', borderBottom: '1px solid rgba(99,102,241,0.09)', backdropFilter: 'blur(20px)' }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 rounded-xl text-slate-400 hover:text-white"
              style={{ background: 'rgba(99,102,241,0.09)' }}>
              <Menu size={18} />
            </button>
            <div>
              <p className="font-bold text-white" style={{ fontSize: 15 }}>{NAV_ITEMS.find(n => n.id === activeTab)?.label}</p>
              <p className="text-slate-500 font-medium hidden sm:block" style={{ fontSize: 12 }}>
                {activeTab === 'dashboard' ? 'Generate & kelola klip viral AI' :
                  activeTab === 'autopilot' ? 'Monitor channel otomatis' :
                    activeTab === 'scheduler' ? 'Antrean posting terjadwal' :
                      activeTab === 'analytics' ? 'Performa konten Anda' :
                        'Log aktivitas sistem'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {/* Watcher status */}
            <div className="hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold"
              style={{ background: watcherStatus.isChecking ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)', border: `1px solid ${watcherStatus.isChecking ? 'rgba(245,158,11,0.22)' : 'rgba(16,185,129,0.22)'}`, color: watcherStatus.isChecking ? '#fbbf24' : '#34d399' }}>
              <span className={`pulse-dot ${watcherStatus.isChecking ? 'bg-amber-400 animate' : 'bg-emerald-400'}`} style={{ width: 7, height: 7 }} />
              {watcherStatus.isChecking ? 'Running' : 'Watching'}
            </div>
            {/* YouTube */}
            <button onClick={handleConnectYoutube} id="yt-connect-btn"
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{ background: isYoutubeConnected ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.12)', border: `1px solid ${isYoutubeConnected ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`, color: isYoutubeConnected ? '#34d399' : '#f87171' }}>
              <Youtube size={14} />
              <span className="hidden sm:inline">{isYoutubeConnected ? 'YouTube ✓' : 'Connect YT'}</span>
            </button>
            {/* Settings */}
            <button onClick={() => setIsSettingsOpen(true)}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-white transition-all"
              style={{ background: 'rgba(99,102,241,0.09)', border: '1px solid rgba(99,102,241,0.13)' }}>
              <Settings size={15} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="content-area">
          <AnimatePresence mode="wait">

            {/* ═══════════════ DASHBOARD TAB ═══════════════════════ */}
            {activeTab === 'dashboard' && (
              <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="content-pad">

                {/* Header row */}
                <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                  <div>
                    <h2 className="section-title mb-1.5">
                      Potong & <span className="gradient-text">Jadwalkan</span> Video
                    </h2>
                    <p className="text-slate-500" style={{ fontSize: 14 }}>
                      Generate klip viral dengan AI — dari YouTube, TikTok, Instagram, & lebih banyak lagi.
                    </p>
                  </div>
                  {/* Mode toggle */}
                  <div className="sub-tabs flex-shrink-0">
                    <button className={`sub-tab ${!isBulkMode ? 'active' : ''}`} onClick={() => setIsBulkMode(false)}>
                      <LinkIcon size={13} style={{ display: 'inline', marginRight: 5 }} />Single URL
                    </button>
                    <button className={`sub-tab ${isBulkMode ? 'active' : ''}`} onClick={() => setIsBulkMode(true)}>
                      <List size={13} style={{ display: 'inline', marginRight: 5 }} />Bulk Mode
                    </button>
                  </div>
                </div>

                {/* Presets row */}
                <PresetBar
                  presets={presets}
                  activeId={activePresetId}
                  onApply={applyPreset}
                  onSaveCurrent={saveCurrentAsPreset}
                  onDelete={deletePreset}
                />

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-5 items-start">
                  {/* ── LEFT: Main form ── */}
                  <div className="xl:col-span-2 space-y-5">
                    <div className="glass-card overflow-hidden">
                      {/* Card header */}
                      <div className="card-header gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: 'linear-gradient(135deg,#6366f1,#7c3aed)' }}>
                          <Wand2 size={15} className="text-white" />
                        </div>
                        <div>
                          <p className="font-bold text-white" style={{ fontSize: 14.5 }}>AI Clip Generator</p>
                          <p className="text-slate-500" style={{ fontSize: 12 }}>Powered by Gemini 1.5 Flash + Groq Llama 3.3</p>
                        </div>
                        {isGenerating && (
                          <div className="ml-auto flex items-center gap-2 text-indigo-400" style={{ fontSize: 12.5 }}>
                            <div className="spinner" style={{ width: 16, height: 16 }} />
                            Menganalisis...
                          </div>
                        )}
                      </div>

                      <div className="card-body space-y-5">
                        {isBulkMode ? (
                          /* ── BULK MODE ── */
                          <BulkUrlPanel
                            bulkUrls={bulkUrls}
                            bulkInput={bulkInput}
                            setBulkInput={setBulkInput}
                            onAdd={handleAddBulkUrls}
                            onRemove={(id) => setBulkUrls(prev => prev.filter(u => u.id !== id))}
                            onClear={() => setBulkUrls([])}
                            onProcess={handleBulkProcess}
                            isProcessing={isBulkProcessing}
                          />
                        ) : (
                          /* ── SINGLE MODE ── */
                          <form onSubmit={handleGenerate} className="space-y-5">
                            {/* URL */}
                            <div>
                              <label className="text-label text-slate-400 block mb-2">Video URL</label>
                              <div className="relative">
                                <LinkIcon size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none" style={{ opacity: 0.5 }} />
                                <input type="text" id="video-url-input" value={url}
                                  onChange={e => setUrl(e.target.value)}
                                  placeholder="Tempel URL YouTube, TikTok, Instagram..."
                                  className="input-modern" style={{ paddingLeft: 44 }} />
                                {url && <button type="button" onClick={() => setUrl('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-300"><X size={14} /></button>}
                              </div>
                              {url && getYouTubeId(url) && (
                                <div className="mt-2 flex items-center gap-2 text-emerald-400" style={{ fontSize: 12 }}>
                                  <CheckCircle2 size={13} /> YouTube ID terdeteksi: <span className="font-mono">{getYouTubeId(url)}</span>
                                </div>
                              )}
                            </div>

                            {/* Format selector */}
                            <div>
                              <label className="text-label text-slate-400 block mb-2.5">Format Output</label>
                              <div className="grid grid-cols-2 gap-3">
                                {([
                                  { v: 'portrait',  icon: <Smartphone size={18} />, label: 'Portrait', sub: 'Shorts / Reels / TikTok', ratio: '9:16' },
                                  { v: 'landscape', icon: <Monitor size={18} />,    label: 'Landscape', sub: 'YouTube / FB Video',   ratio: '16:9' },
                                ] as const).map(f => (
                                  <button key={f.v} type="button" onClick={() => setFormat(f.v)}
                                    className={`format-card ${format === f.v ? 'selected' : ''}`}>
                                    <span style={{ color: format === f.v ? '#818cf8' : '#334155' }}>{f.icon}</span>
                                    <div className="flex-1">
                                      <p className="font-bold" style={{ fontSize: 14, color: format === f.v ? '#c7d2fe' : '#64748b' }}>{f.label}</p>
                                      <p style={{ fontSize: 11.5, color: format === f.v ? '#6366f1' : '#2d3a52' }}>{f.sub}</p>
                                    </div>
                                    <span className="badge badge-blue" style={{ fontSize: 10 }}>{f.ratio}</span>
                                    {format === f.v && <CheckCircle2 size={16} className="text-indigo-400 flex-shrink-0" />}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Count + Quality */}
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="text-label text-slate-400 block mb-2">Jumlah Klip</label>
                                <select value={count} onChange={e => setCount(Number(e.target.value))} className="input-modern" id="clip-count-select">
                                  <option value={2}>2 Klip</option>
                                  <option value={4}>4 Klip</option>
                                  <option value={6}>6 Klip</option>
                                  <option value={8}>8 Klip</option>
                                  <option value={12}>12 Klip</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-label text-slate-400 block mb-2">Kualitas Video</label>
                                <select value={quality} onChange={e => setQuality(e.target.value)} className="input-modern" id="quality-select">
                                  <option value="360p">360p — Ringan</option>
                                  <option value="480p">480p</option>
                                  <option value="720p">720p ⭐ Rekomendasi</option>
                                  <option value="1080p">1080p HD</option>
                                </select>
                              </div>
                            </div>

                            {/* Feature toggles */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className="text-label text-slate-400 block mb-2">Burn Subtitle</label>
                                <button type="button" id="subtitle-toggle"
                                  onClick={() => setUseSubtitles(!useSubtitles)}
                                  className={`feature-toggle ${useSubtitles ? 'on' : ''}`}>
                                  <span className={`toggle-dot ${useSubtitles ? 'on' : 'off'}`} />
                                  {useSubtitles ? 'Aktif' : 'Nonaktif'}
                                </button>
                              </div>
                              <div>
                                <label className="text-label text-slate-400 block mb-2">Edit Transkrip (Sebelum AI)</label>
                                <button type="button"
                                  onClick={() => { setEditTranscriptMode(!editTranscriptMode); setIsTranscriptFetched(false); }}
                                  className={`feature-toggle ${editTranscriptMode ? 'on' : ''}`}>
                                  <span className={`toggle-dot ${editTranscriptMode ? 'on' : 'off'}`} />
                                  {editTranscriptMode ? 'Aktif' : 'Nonaktif'}
                                </button>
                              </div>
                            </div>

                            {/* Caption & Crop Styles */}
                            {(useSubtitles || format === 'portrait') && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3 animate-fade-in">
                                {useSubtitles && (
                                  <div>
                                    <label className="text-label text-slate-400 block mb-2">Gaya Caption</label>
                                    <div className="flex rounded-xl overflow-hidden h-11" style={{ border: '1px solid rgba(99,102,241,0.16)' }}>
                                      {(['tiktok', 'normal'] as const).map((s, i) => (
                                        <button key={s} type="button" onClick={() => setCaptionStyle(s)}
                                          className="flex-1 text-sm font-semibold transition-all capitalize"
                                          style={{ background: captionStyle === s ? 'rgba(99,102,241,0.24)' : 'rgba(6,9,22,0.8)', color: captionStyle === s ? '#c7d2fe' : '#475569', borderRight: i === 0 ? '1px solid rgba(99,102,241,0.16)' : 'none' }}>
                                          {s}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {format === 'portrait' && (
                                  <div>
                                    <label className="text-label text-slate-400 block mb-2">Mode Crop Video</label>
                                    <div className="flex rounded-xl overflow-hidden h-11" style={{ border: '1px solid rgba(99,102,241,0.16)' }}>
                                      {(['reframe', 'center', 'split'] as const).map((m, i) => (
                                        <button key={m} type="button" onClick={() => setVideoMode(m)}
                                          className="flex-1 font-semibold transition-all"
                                          style={{ fontSize: 11, background: videoMode === m ? 'rgba(99,102,241,0.24)' : 'rgba(6,9,22,0.8)', color: videoMode === m ? '#c7d2fe' : '#475569', borderRight: i < 2 ? '1px solid rgba(99,102,241,0.16)' : 'none' }}>
                                          {m === 'reframe' ? '🤖 AI Reframe' : m === 'center' ? '⊕ Center' : '⊡ Split'}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Subtitle Customizer */}
                            {useSubtitles && captionStyle === 'tiktok' && (
                              <div className="p-4 rounded-xl space-y-4 mt-3 animate-fade-in" style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.1)' }}>
                                <p className="text-label text-indigo-400 flex items-center gap-1.5" style={{ fontSize: 11.5 }}><Sliders size={13} /> Kustomisasi Subtitle</p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  <div>
                                    <label className="text-label text-slate-500 block mb-1.5" style={{ fontSize: 11 }}>Font Family</label>
                                    <select value={subFontName} onChange={e => setSubFontName(e.target.value)} className="input-modern" style={{ height: 38, fontSize: 12.5, padding: '0 10px' }}>
                                      <option value="Impact">Impact (Default)</option>
                                      <option value="Arial">Arial</option>
                                      <option value="Montserrat">Montserrat</option>
                                      <option value="Space Grotesk">Space Grotesk</option>
                                      <option value="Comic Sans MS">Comic Sans</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-label text-slate-500 block mb-1.5" style={{ fontSize: 11 }}>Ukuran Font</label>
                                    <select value={subFontSize} onChange={e => setSubFontSize(Number(e.target.value))} className="input-modern" style={{ height: 38, fontSize: 12.5, padding: '0 10px' }}>
                                      <option value={36}>36px (Kecil)</option>
                                      <option value={48}>48px (Sedang)</option>
                                      <option value={56}>56px (Besar)</option>
                                      <option value={64}>64px (Extra)</option>
                                      <option value={72}>72px (Jumbo)</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-label text-slate-500 block mb-1.5" style={{ fontSize: 11 }}>Warna Highlight</label>
                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                      {([
                                        { id: 'yellow', color: '#fbbf24' },
                                        { id: 'green', color: '#34d399' },
                                        { id: 'cyan', color: '#22d3ee' },
                                        { id: 'orange', color: '#f97316' },
                                        { id: 'pink', color: '#f472b6' },
                                        { id: 'white', color: '#ffffff' }
                                      ] as const).map(c => (
                                        <button key={c.id} type="button" onClick={() => setSubHighlightColor(c.id)} title={c.id}
                                          className={`w-6 h-6 rounded-full border transition-all flex items-center justify-center`}
                                          style={{ backgroundColor: c.color, borderColor: subHighlightColor === c.id ? '#6366f1' : 'transparent', borderWidth: subHighlightColor === c.id ? 2 : 0, transform: subHighlightColor === c.id ? 'scale(1.15)' : 'none' }}>
                                          {subHighlightColor === c.id && <div className="w-1.5 h-1.5 rounded-full bg-slate-900" />}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Transcript Review Card */}
                            {editTranscriptMode && isTranscriptFetched && (
                              <div className="p-4 rounded-xl space-y-3 mt-4 animate-fade-in" style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.1)' }}>
                                <div className="flex items-center justify-between">
                                  <p className="text-label text-indigo-400 flex items-center gap-1.5" style={{ fontSize: 11.5 }}><FileText size={14} /> Review & Edit Script</p>
                                  <button type="button" onClick={() => setIsTranscriptFetched(false)} className="text-xs text-slate-500 hover:text-indigo-400 transition-colors">Reset Transkrip</button>
                                </div>
                                {fetchedVideoInfo && (
                                  <div className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-950/60 border border-slate-900">
                                    {fetchedVideoInfo.thumbnail && <img src={fetchedVideoInfo.thumbnail} className="w-16 h-10 object-cover rounded" alt="Video Thumbnail" />}
                                    <div className="overflow-hidden">
                                      <p className="font-bold text-white truncate text-sm">{fetchedVideoInfo.title || 'Video Title'}</p>
                                      <p className="text-xs text-slate-500 truncate">{fetchedVideoInfo.description?.substring(0, 80)}...</p>
                                    </div>
                                  </div>
                                )}
                                <textarea value={editableTranscript} onChange={e => setEditableTranscript(e.target.value)}
                                  placeholder="Tempel atau ketik transkrip video di sini..."
                                  className="input-modern font-mono" rows={8} style={{ fontSize: 12.5, resize: 'vertical', lineHeight: 1.6 }} />
                                <div className="text-xs text-slate-500 flex justify-between">
                                  <span>Karakter: {editableTranscript.length}</span>
                                  <span>Tips: Edit teks di atas untuk memfokuskan analisis klip AI.</span>
                                </div>
                                <button type="button" onClick={handleGenerateWithEditedTranscript} disabled={isGenerating}
                                  className="btn-primary w-full mt-2" style={{ padding: '12px', fontSize: 14.5, borderRadius: 11 }}>
                                  {isGenerating ? <><div className="spinner" /><span>Menganalisis Klip dengan AI...</span></> : <><Sparkles size={15} /><span>Mulai Analisis Klip AI</span></>}
                                </button>
                              </div>
                            )}

                            {/* Submit (or Fetch) Button */}
                            {(!editTranscriptMode || !isTranscriptFetched) && (
                              <button type="submit" id="generate-btn" disabled={isGenerating || isFetchingTranscript || !url} className="btn-primary w-full"
                                style={{ padding: 15, fontSize: 15, borderRadius: 13 }}>
                                {editTranscriptMode ? (
                                  isFetchingTranscript ? (
                                    <><div className="spinner" /><span>Mengambil Transkrip...</span></>
                                  ) : (
                                    <><FileText size={17} /><span>Ambil & Review Transkrip</span><ChevronRight size={16} /></>
                                  )
                                ) : (
                                  isGenerating ? (
                                    <><div className="spinner" /><span>Menganalisis Konten AI...</span></>
                                  ) : (
                                    <><Sparkles size={17} /><span>Generate Viral Clips</span><ChevronRight size={16} /></>
                                  )
                                )}
                              </button>
                            )}
                          </form>
                        )}

                        {/* Error */}
                        <AnimatePresence>
                          {error && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                              className="flex items-start gap-3 p-4 rounded-xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                              <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                              <p className="text-red-400 font-medium" style={{ fontSize: 13.5 }}>{error}</p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>

                  {/* ── RIGHT: Widgets ── */}
                  <div className="xl:col-span-1 space-y-4">
                    {/* AI Status */}
                    <div className="glass-card overflow-hidden">
                      <div className="card-header gap-2.5">
                        <Brain size={15} className="text-indigo-400" />
                        <p className="font-bold text-slate-300 text-label">Status Sistem AI</p>
                      </div>
                      <div className="card-body space-y-3.5">
                        {[
                          { label: 'Primary AI', value: 'Gemini 1.5 Flash', badge: 'badge-blue' },
                          { label: 'Fallback AI', value: 'Groq Llama 3.3', badge: '' },
                          { label: 'AI Reframe', value: 'Aktif ✓', badge: 'badge-green' },
                          { label: 'Kinetic Sub', value: 'Ready', badge: 'badge-blue' },
                        ].map(item => (
                          <div key={item.label} className="flex items-center justify-between">
                            <span className="text-slate-500" style={{ fontSize: 13 }}>{item.label}</span>
                            <span className={`badge ${item.badge || 'text-slate-400 font-semibold'}`} style={{ fontSize: 11 }}>{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Manual Clip Maker */}
                    {url && !isBulkMode && (
                      <div className="glass-card overflow-hidden animate-fade-in">
                        <div className="card-header gap-2.5">
                          <Scissors size={15} className="text-purple-400 animate-pulse" />
                          <p className="font-bold text-slate-300 text-label">Manual Clip Maker</p>
                        </div>
                        <form onSubmit={handleAddManualClip} className="card-body space-y-3.5">
                          <div>
                            <label className="text-label text-slate-500 block mb-1" style={{ fontSize: 11 }}>Judul Klip</label>
                            <input type="text" placeholder="Contoh: Momen Lucu Lucu" value={manualTitle}
                              onChange={e => setManualTitle(e.target.value)} className="input-modern font-semibold" style={{ height: 38, fontSize: 13, padding: '0 12px' }} />
                          </div>
                          <div className="grid grid-cols-2 gap-2.5">
                            <div>
                              <label className="text-label text-slate-500 block mb-1" style={{ fontSize: 11 }}>Mulai (Detik)</label>
                              <input type="number" min={0} step={1} value={manualStart}
                                onChange={e => setManualStart(Number(e.target.value))} className="input-modern font-mono" style={{ height: 38, fontSize: 13, padding: '0 12px' }} />
                            </div>
                            <div>
                              <label className="text-label text-slate-500 block mb-1" style={{ fontSize: 11 }}>Selesai (Detik)</label>
                              <input type="number" min={manualStart + 1} step={1} value={manualEnd}
                                onChange={e => setManualEnd(Number(e.target.value))} className="input-modern font-mono" style={{ height: 38, fontSize: 13, padding: '0 12px' }} />
                            </div>
                          </div>
                          <div>
                            <label className="text-label text-slate-500 block mb-1" style={{ fontSize: 11 }}>🎣 Hook (🎣)</label>
                            <input type="text" placeholder="Contoh: Ternyata dia malah..." value={manualHook}
                              onChange={e => setManualHook(e.target.value)} className="input-modern" style={{ height: 38, fontSize: 13, padding: '0 12px' }} />
                          </div>
                          <div>
                            <label className="text-label text-slate-500 block mb-1" style={{ fontSize: 11 }}>Hashtags (koma)</label>
                            <input type="text" placeholder="gaming, shorts, viral" value={manualTags}
                              onChange={e => setManualTags(e.target.value)} className="input-modern" style={{ height: 38, fontSize: 13, padding: '0 12px' }} />
                          </div>
                          <button type="submit" className="btn-secondary w-full" style={{ padding: '11px', borderRadius: 10, fontSize: 13 }}>
                            <Plus size={14} /> Tambahkan Klip Manual
                          </button>
                        </form>
                      </div>
                    )}

                    {/* Viral Tips */}
                    <div className="glass-card overflow-hidden">
                      <div className="card-header gap-2.5">
                        <Flame size={15} className="text-amber-400" />
                        <p className="font-bold text-slate-300 text-label">Tips Viral</p>
                      </div>
                      <ul className="card-body space-y-3.5">
                        {[
                          { e: '⚡', t: 'Hook 3 detik pertama menentukan retensi penonton.' },
                          { e: '🎯', t: 'AI Reframe secara otomatis mengikuti wajah pembicara.' },
                          { e: '🏷️', t: 'Gunakan 6–10 hashtag relevan untuk jangkauan maksimal.' },
                          { e: '📐', t: '720p+ direkomendasikan untuk Shorts, Reels, dan TikTok.' },
                          { e: '🕒', t: 'Post di jam prime time: 18:00–21:00 WIB untuk engagement terbaik.' },
                        ].map((t, i) => (
                          <li key={i} className="flex gap-3 items-start">
                            <span style={{ fontSize: 16, flexShrink: 0 }}>{t.e}</span>
                            <span className="text-slate-500" style={{ fontSize: 13 }}>{t.t}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* ── Clips Grid ── */}
                <AnimatePresence>
                  {clips.length > 0 && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mt-8 space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <h3 className="font-bold text-white" style={{ fontSize: 18 }}>Hasil Klip AI</h3>
                          <span className="badge badge-blue">{clips.length} klip</span>
                          {clips.length > 0 && (
                            <span className="badge badge-green">
                              Avg Score: {Math.round(clips.reduce((a, c) => a + c.viralScore, 0) / clips.length)}%
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleBatchDownloadAll(clips, url, quality, useSubtitles, captionStyle, videoMode, subFontName, subFontSize, subHighlightColor, authedFetch, showToast)}
                            className="btn-secondary" style={{ fontSize: 13 }}>
                            <Download size={14} /> Batch Download All
                          </button>
                          <button onClick={() => setClips([])} className="btn-ghost" style={{ fontSize: 13 }}>
                            <X size={13} /> Clear
                          </button>
                        </div>
                      </div>
                      <div className="grid-clips">
                        {clips.map((clip, i) => (
                          <ClipCard key={i} clip={clip} index={i} originalUrl={url}
                            quality={quality} useSubtitles={useSubtitles} captionStyle={captionStyle}
                            videoMode={videoMode} isYoutubeConnected={isYoutubeConnected}
                            subFontName={subFontName} subFontSize={subFontSize} subHighlightColor={subHighlightColor}
                            onActionSuccess={fetchHistory} authedFetch={authedFetch} showToast={showToast} />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* ═══════════════ AUTOPILOT TAB ═══════════════════════ */}
            {activeTab === 'autopilot' && (
              <motion.div key="autopilot" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="content-pad">
                <div className="mb-6">
                  <h2 className="section-title mb-1.5">Channel <span className="gradient-text">Watcher</span></h2>
                  <p className="text-slate-500" style={{ fontSize: 14 }}>Monitor channel secara otomatis, deteksi video baru, proses AI, dan jadwalkan posting.</p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  {/* Add Channel */}
                  <div className="glass-card overflow-hidden">
                    <div className="card-header gap-2.5">
                      <Plus size={15} className="text-indigo-400" />
                      <p className="text-label text-slate-300">Tambah Channel</p>
                    </div>
                    <div className="card-body space-y-4">
                      <p className="text-slate-500" style={{ fontSize: 13.5 }}>Masukkan Channel ID YouTube. Sistem akan memeriksa video baru setiap jam secara otomatis.</p>
                      <form onSubmit={handleAddChannel} className="space-y-3">
                        <input type="text" placeholder="UCxxxxxxxxxxxxxxxxxx" value={newChannelId}
                          onChange={e => setNewChannelId(e.target.value)} className="input-modern mono" id="channel-id-input" />
                        <button type="submit" className="btn-primary w-full" style={{ borderRadius: 11 }}>
                          <Plus size={15} /> Tambahkan Channel
                        </button>
                      </form>
                      <div className="p-3.5 rounded-xl" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.13)' }}>
                        <p className="text-slate-500" style={{ fontSize: 12 }}>
                          💡 <strong className="text-slate-400">Cara dapat Channel ID:</strong> Buka YouTube channel → URL: youtube.com/channel/<span className="text-indigo-400">UCxxxx</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Channel list */}
                  <div className="glass-card overflow-hidden flex flex-col">
                    <div className="card-header gap-2.5">
                      <Eye size={15} className="text-indigo-400" />
                      <p className="text-label text-slate-300 flex-1">Channel Dipantau</p>
                      <span className="badge badge-blue">{watchedChannels.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2.5 max-h-72">
                      {watchedChannels.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <Globe size={28} className="text-slate-700 mb-3" />
                          <p className="text-slate-600" style={{ fontSize: 13.5 }}>Belum ada channel terdaftar.</p>
                        </div>
                      ) : watchedChannels.map(id => (
                        <div key={id} className="url-item">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(239,68,68,0.14)' }}>
                            <Youtube size={14} className="text-red-400" />
                          </div>
                          <span className="url-text">{id}</span>
                          <button onClick={() => handleRemoveChannel(id)} className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Live activity */}
                  <div className="glass-card overflow-hidden flex flex-col">
                    <div className="card-header gap-2.5">
                      <Activity size={15} className="text-indigo-400" />
                      <p className="text-label text-slate-300 flex-1">Live Activity</p>
                      <button onClick={handleRunWatcher} disabled={watcherStatus.isChecking}
                        className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px', borderRadius: 9 }}>
                        <PlaySquare size={12} /> Run Now
                      </button>
                    </div>
                    <div className="flex-1 p-4 overflow-y-auto max-h-72 font-mono" style={{ fontSize: 11.5 }}>
                      <div className="flex items-center justify-between mb-3 pb-2.5" style={{ borderBottom: '1px solid rgba(99,102,241,0.08)' }}>
                        <span className="text-slate-600">Status:</span>
                        <span className={`font-bold ${watcherStatus.isChecking ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {watcherStatus.isChecking ? '● RUNNING' : '○ WAITING'}
                        </span>
                      </div>
                      <div className="space-y-2 text-slate-500">
                        {(!watcherStatus.logs?.length) && <p className="italic text-slate-700">Belum ada log.</p>}
                        {watcherStatus.logs?.map((log: string, i: number) => (
                          <div key={i} className="flex gap-2"><span className="text-indigo-700 flex-shrink-0">›</span>
                            <span className="truncate" title={log}>{log}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ═══════════════ SCHEDULER TAB ═══════════════════════ */}
            {activeTab === 'scheduler' && (
              <motion.div key="scheduler" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="content-pad">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                  <div>
                    <h2 className="section-title mb-1.5">Scheduler <span className="gradient-text">Queue</span></h2>
                    <p className="text-slate-500" style={{ fontSize: 14 }}>Antrean video klip untuk diposting otomatis ke platform sosial.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="badge badge-blue">{scheduledJobs.length} jobs</span>
                    <span className="badge badge-amber">{pendingJobs} pending</span>
                    <button onClick={fetchScheduledJobs} className="btn-ghost" style={{ fontSize: 13 }}><RefreshCcw size={13} /></button>
                  </div>
                </div>
                <div className="glass-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead><tr>
                        <th>Platform</th><th>Konten</th><th>Jadwal Upload</th><th>Status</th><th className="text-right">Aksi</th>
                      </tr></thead>
                      <tbody>
                        {scheduledJobs.map(item => (
                          <tr key={item.id}>
                            <td><PlatformCell platform={item.platform} /></td>
                            <td>
                              <p className="font-semibold text-white truncate max-w-[220px]" style={{ fontSize: 13.5 }} title={item.title}>{item.title}</p>
                              <p className="text-slate-600 truncate max-w-[220px]" style={{ fontSize: 12 }} title={item.description}>{item.description}</p>
                            </td>
                            <td className="font-mono">
                              <div style={{ fontSize: 13 }}>{new Date(Number(item.scheduled_time)).toLocaleDateString()}</div>
                              <div className="text-slate-600" style={{ fontSize: 11.5 }}>{new Date(Number(item.scheduled_time)).toLocaleTimeString()}</div>
                            </td>
                            <td><StatusBadge status={item.status} />{item.error_message && <p className="text-red-400 mt-1 truncate max-w-[140px]" style={{ fontSize: 11 }} title={item.error_message}>{item.error_message}</p>}</td>
                            <td className="text-right">
                              <button onClick={() => handleCancelSchedule(item.id)} className="btn-danger" style={{ fontSize: 12.5, padding: '7px 13px', borderRadius: 9 }}>
                                Batalkan
                              </button>
                            </td>
                          </tr>
                        ))}
                        {scheduledJobs.length === 0 && (
                          <tr><td colSpan={5} className="text-center py-20">
                            <CalendarClock size={36} className="text-slate-800 mx-auto mb-3" />
                            <p className="text-slate-600 font-medium" style={{ fontSize: 15 }}>Belum ada postingan dijadwalkan</p>
                            <p className="text-slate-700 mt-1" style={{ fontSize: 13 }}>Generate klip dan jadwalkan dari Dashboard</p>
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ═══════════════ ANALYTICS TAB ═══════════════════════ */}
            {activeTab === 'analytics' && (
              <motion.div key="analytics" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="content-pad">
                <AnalyticsTab historyData={historyData} scheduledJobs={scheduledJobs} clips={clips} />
              </motion.div>
            )}

            {/* ═══════════════ HISTORY TAB ═══════════════════════ */}
            {activeTab === 'history' && (
              <motion.div key="history" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="content-pad">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                  <div>
                    <h2 className="section-title mb-1.5">Activity <span className="gradient-text">Log</span></h2>
                    <p className="text-slate-500" style={{ fontSize: 14 }}>Log riwayat proses ekspor, posting ke platform sosial, dan aktivitas autopilot.</p>
                  </div>
                  <span className="badge badge-blue">{historyData.length} entries</span>
                </div>
                <div className="glass-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead><tr><th>Aktivitas</th><th>Video / Klip</th><th>Waktu</th><th>Status</th><th className="text-right">Link</th></tr></thead>
                      <tbody>
                        {historyData.map(item => (
                          <tr key={item.id}>
                            <td>
                              <div className="flex items-center gap-3">
                                <div className="platform-icon" style={{ width: 34, height: 34, borderRadius: 9, background: item.type === 'upload' ? 'rgba(239,68,68,0.12)' : item.type?.includes('facebook') ? 'rgba(59,130,246,0.12)' : item.type === 'auto_process' ? 'rgba(245,158,11,0.12)' : 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {item.type === 'upload' ? <Youtube size={15} className="text-red-400" /> : item.type?.includes('facebook') ? <Facebook size={15} className="text-blue-400" /> : item.type === 'auto_process' ? <Zap size={15} className="text-amber-400" /> : <Download size={15} className="text-indigo-400" />}
                                </div>
                                <div>
                                  <p className="font-semibold text-white capitalize" style={{ fontSize: 13.5 }}>{item.type?.replace(/_/g, ' ')}</p>
                                  <span className="badge" style={{ fontSize: 10, padding: '1px 6px', background: 'rgba(30,41,59,0.8)', color: '#475569', border: '1px solid rgba(99,102,241,0.1)' }}>{item.format || 'original'}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <p className="font-medium text-slate-300 truncate max-w-[200px]" style={{ fontSize: 13.5 }} title={item.title || item.videoTitle}>{item.title || item.videoTitle || '—'}</p>
                              {item.start !== undefined && <p className="text-slate-600 font-mono flex items-center gap-1 mt-0.5" style={{ fontSize: 11.5 }}><Clock size={10} /> {item.start}s – {item.end}s</p>}
                            </td>
                            <td className="font-mono">
                              <div style={{ fontSize: 13 }}>{new Date(item.timestamp).toLocaleDateString()}</div>
                              <div className="text-slate-600" style={{ fontSize: 11.5 }}>{new Date(item.timestamp).toLocaleTimeString()}</div>
                            </td>
                            <td><StatusBadge status={item.status} /></td>
                            <td className="text-right">
                              {item.details?.videoId ? (
                                <a href={item.type?.includes('facebook') ? `https://facebook.com/${item.details.videoId}` : `https://youtube.com/shorts/${item.details.videoId}`}
                                  target="_blank" rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all"
                                  style={{ background: item.type?.includes('facebook') ? 'rgba(59,130,246,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${item.type?.includes('facebook') ? 'rgba(59,130,246,0.22)' : 'rgba(239,68,68,0.22)'}`, color: item.type?.includes('facebook') ? '#60a5fa' : '#f87171' }}>
                                  <ExternalLink size={11} /> {item.type?.includes('facebook') ? 'FB' : 'YT'}
                                </a>
                              ) : <span className="text-slate-700" style={{ fontSize: 13 }}>—</span>}
                            </td>
                          </tr>
                        ))}
                        {historyData.length === 0 && (
                          <tr><td colSpan={5} className="text-center py-20">
                            <BarChart3 size={36} className="text-slate-800 mx-auto mb-3" />
                            <p className="text-slate-600 font-medium" style={{ fontSize: 15 }}>Belum ada aktivitas</p>
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} authedFetch={authedFetch} showToast={showToast} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// BATCH DOWNLOAD ALL
// ────────────────────────────────────────────────────────────────────────────
async function handleBatchDownloadAll(
  clips: ClipMetadata[],
  originalUrl: string,
  quality: string,
  useSubtitles: boolean,
  captionStyle: string,
  videoMode: string,
  subFontName: string,
  subFontSize: number,
  subHighlightColor: string,
  authedFetch: any,
  showToast: any
) {
  showToast(`Memulai batch download ${clips.length} klip...`, 'info');
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    try {
      const response = await authedFetch(`/api/download-clip?url=${encodeURIComponent(originalUrl)}&start=${clip.startTimeSeconds}&end=${clip.endTimeSeconds}&format=${clip.aspectRatio}&quality=${quality}&useSubtitles=${useSubtitles}&captionStyle=${captionStyle}&videoMode=${videoMode}&subFontName=${subFontName || ''}&subFontSize=${subFontSize || ''}&subHighlightColor=${subHighlightColor || ''}`);
      if (!response?.ok) continue;
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `viral_clip_${i + 1}_${clip.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp4`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      await new Promise(r => setTimeout(r, 500));
    } catch {}
  }
  showToast('Batch download selesai!', 'success');
}

// ────────────────────────────────────────────────────────────────────────────
// PRESET BAR
// ────────────────────────────────────────────────────────────────────────────
function PresetBar({ presets, activeId, onApply, onSaveCurrent, onDelete }: {
  presets: Preset[]; activeId: string | null; onApply: (p: Preset) => void;
  onSaveCurrent: () => void; onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 p-3.5 rounded-xl" style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.1)' }}>
      <span className="text-slate-500 font-semibold flex items-center gap-1.5 flex-shrink-0" style={{ fontSize: 12 }}>
        <BookMarked size={13} /> Preset:
      </span>
      <div className="flex flex-wrap gap-2 flex-1">
        {presets.map(p => (
          <div key={p.id} className="relative flex items-center gap-1 group">
            <button onClick={() => onApply(p)}
              className={`preset-card ${activeId === p.id ? 'active' : ''} flex items-center gap-1.5`}
              style={{ padding: '6px 13px', fontSize: 12.5 }}>
              {p.name}
            </button>
            {!['tiktok-viral','shorts-pro','reels-ig','fb-video'].includes(p.id) && (
              <button onClick={() => onDelete(p.id)}
                className="opacity-0 group-hover:opacity-100 absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-red-400 hover:text-white transition-all"
                style={{ background: 'rgba(239,68,68,0.85)', fontSize: 9 }}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button onClick={onSaveCurrent} className="btn-ghost flex-shrink-0" style={{ fontSize: 12, padding: '7px 13px', borderRadius: 10 }}>
        <Plus size={13} /> Simpan Preset
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// BULK URL PANEL
// ────────────────────────────────────────────────────────────────────────────
function BulkUrlPanel({ bulkUrls, bulkInput, setBulkInput, onAdd, onRemove, onClear, onProcess, isProcessing }: {
  bulkUrls: BulkUrl[]; bulkInput: string; setBulkInput: (v: string) => void;
  onAdd: () => void; onRemove: (id: string) => void; onClear: () => void;
  onProcess: () => void; isProcessing: boolean;
}) {
  const pending = bulkUrls.filter(u => u.status === 'idle').length;
  const done    = bulkUrls.filter(u => u.status === 'done').length;
  const errors  = bulkUrls.filter(u => u.status === 'error').length;

  return (
    <div className="space-y-4">
      <div className="p-3.5 rounded-xl" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.14)' }}>
        <p className="text-slate-400 font-semibold mb-2.5 flex items-center gap-2" style={{ fontSize: 13 }}>
          <List size={14} className="text-indigo-400" /> Paste URL (satu per baris)
        </p>
        <textarea value={bulkInput} onChange={e => setBulkInput(e.target.value)}
          placeholder={"https://youtube.com/watch?v=...\nhttps://youtube.com/watch?v=...\nhttps://youtu.be/..."}
          className="input-modern" rows={5} style={{ resize: 'vertical' }} />
        <div className="flex gap-2 mt-3">
          <button onClick={onAdd} disabled={!bulkInput.trim()} className="btn-primary" style={{ fontSize: 13, padding: '10px 18px', borderRadius: 10 }}>
            <Plus size={14} /> Tambah ke Antrean
          </button>
          {bulkUrls.length > 0 && <button onClick={onClear} className="btn-ghost" style={{ fontSize: 13 }}><Trash2 size={13} /> Clear All</button>}
        </div>
      </div>

      {bulkUrls.length > 0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="badge badge-blue">{bulkUrls.length} total</span>
            <span className="badge badge-amber">{pending} pending</span>
            <span className="badge badge-green">{done} done</span>
            {errors > 0 && <span className="badge badge-red">{errors} error</span>}
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {bulkUrls.map(item => (
              <div key={item.id} className="url-item">
                <span className={`url-status-dot ${item.status === 'done' ? 'bg-emerald-400' : item.status === 'error' ? 'bg-red-400' : item.status === 'processing' ? 'bg-amber-400' : 'bg-slate-600'}`} />
                <span className="url-text">{item.url}</span>
                {item.status === 'done' && <span className="badge badge-green" style={{ fontSize: 10 }}>{item.clipsCount} klip</span>}
                {item.status === 'processing' && <div className="spinner" style={{ width: 14, height: 14 }} />}
                {item.status !== 'processing' && (
                  <button onClick={() => onRemove(item.id)} className="text-slate-600 hover:text-red-400 transition-colors flex-shrink-0"><X size={13} /></button>
                )}
              </div>
            ))}
          </div>
          {pending > 0 && (
            <button onClick={onProcess} disabled={isProcessing} className="btn-primary w-full" style={{ fontSize: 14, padding: 14, borderRadius: 12 }}>
              {isProcessing ? <><div className="spinner" /><span>Memproses {pending} URL...</span></> : <><Layers size={16} /><span>Proses Semua ({pending} URL)</span></>}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ANALYTICS TAB
// ────────────────────────────────────────────────────────────────────────────
function AnalyticsTab({ historyData, scheduledJobs, clips }: { historyData: any[]; scheduledJobs: any[]; clips: ClipMetadata[] }) {
  const totalUploads    = historyData.filter(h => h.type?.includes('upload') || h.type?.includes('auto_process')).length;
  const successUploads  = historyData.filter(h => h.status === 'success').length;
  const failedUploads   = historyData.filter(h => h.status === 'failed' || h.status === 'error').length;
  const avgViralScore   = clips.length ? Math.round(clips.reduce((a, c) => a + c.viralScore, 0) / clips.length) : 0;
  const successRate     = totalUploads > 0 ? Math.round((successUploads / totalUploads) * 100) : 0;

  // Platform breakdown
  const platformCounts: Record<string, number> = { youtube: 0, facebook: 0, instagram: 0, tiktok: 0 };
  historyData.forEach(h => {
    if (h.type?.includes('youtube') || h.type === 'upload') platformCounts.youtube++;
    else if (h.type?.includes('facebook')) platformCounts.facebook++;
    else if (h.type?.includes('instagram')) platformCounts.instagram++;
    else if (h.type?.includes('tiktok')) platformCounts.tiktok++;
  });

  // Last 7 days activity
  const now = Date.now();
  const dayMs = 86400000;
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const dayStart = now - (6 - i) * dayMs;
    const dayEnd   = dayStart + dayMs;
    const count = historyData.filter(h => {
      const t = new Date(h.timestamp).getTime();
      return t >= dayStart && t < dayEnd;
    }).length;
    const label = new Date(dayStart).toLocaleDateString('id-ID', { weekday: 'short' });
    return { label, count };
  });
  const maxDay = Math.max(...last7.map(d => d.count), 1);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="section-title mb-1.5">Analytics <span className="gradient-text">Dashboard</span></h2>
        <p className="text-slate-500" style={{ fontSize: 14 }}>Pantau performa konten dan statistik sistem Anda.</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Upload', value: totalUploads, icon: <Upload size={18} />, color: '#818cf8', badge: 'badge-blue' },
          { label: 'Berhasil', value: successUploads, icon: <CheckCircle size={18} />, color: '#34d399', badge: 'badge-green' },
          { label: 'Success Rate', value: `${successRate}%`, icon: <Target size={18} />, color: '#fbbf24', badge: 'badge-amber' },
          { label: 'Avg Viral Score', value: `${avgViralScore}%`, icon: <TrendingUp size={18} />, color: '#a78bfa', badge: 'badge-purple' },
        ].map(s => (
          <div key={s.label} className="stat-box">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `rgba(${s.color === '#818cf8' ? '99,102,241' : s.color === '#34d399' ? '16,185,129' : s.color === '#fbbf24' ? '245,158,11' : '167,139,250'},0.15)`, color: s.color }}>
                {s.icon}
              </div>
              <span className={`badge ${s.badge}`} style={{ fontSize: 10 }}>Total</span>
            </div>
            <p className="stat-value" style={{ color: s.color }}>{s.value}</p>
            <p className="stat-label">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 7-day chart */}
        <div className="glass-card overflow-hidden">
          <div className="card-header gap-2.5">
            <BarChart3 size={15} className="text-indigo-400" />
            <p className="text-label text-slate-300">Aktivitas 7 Hari Terakhir</p>
          </div>
          <div className="card-body">
            {last7.every(d => d.count === 0) ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <BarChart3 size={32} className="text-slate-800 mb-3" />
                <p className="text-slate-600" style={{ fontSize: 14 }}>Belum ada data aktivitas</p>
              </div>
            ) : (
              <div className="flex items-end gap-2 h-44">
                {last7.map((d, i) => (
                  <div key={i} className="chart-bar">
                    <div className="chart-bar-fill w-full" style={{ height: `${Math.round((d.count / maxDay) * 100)}%`, minHeight: d.count > 0 ? '8px' : '4px', opacity: d.count === 0 ? 0.3 : 1 }} />
                    <span className="text-slate-600 font-semibold" style={{ fontSize: 11 }}>{d.label}</span>
                    {d.count > 0 && <span className="text-indigo-400 font-bold" style={{ fontSize: 11 }}>{d.count}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Platform breakdown */}
        <div className="glass-card overflow-hidden">
          <div className="card-header gap-2.5">
            <PieChart size={15} className="text-indigo-400" />
            <p className="text-label text-slate-300">Distribusi Platform</p>
          </div>
          <div className="card-body space-y-4">
            {[
              { p: 'youtube', label: 'YouTube Shorts', color: '#ef4444', icon: <Youtube size={14} /> },
              { p: 'facebook', label: 'Facebook Page', color: '#3b82f6', icon: <Facebook size={14} /> },
              { p: 'instagram', label: 'Instagram Reels', color: '#ec4899', icon: <Instagram size={14} /> },
              { p: 'tiktok', label: 'TikTok', color: '#14b8a6', icon: <Zap size={14} /> },
            ].map(pt => {
              const cnt = platformCounts[pt.p];
              const pct = totalUploads > 0 ? Math.round((cnt / totalUploads) * 100) : 0;
              return (
                <div key={pt.p} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2" style={{ color: pt.color }}>
                      {pt.icon}
                      <span className="font-semibold text-slate-300" style={{ fontSize: 13.5 }}>{pt.label}</span>
                    </div>
                    <span className="font-bold text-slate-300" style={{ fontSize: 13 }}>{cnt} <span className="text-slate-600">({pct}%)</span></span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${pt.color}99, ${pt.color})` }} />
                  </div>
                </div>
              );
            })}
            {totalUploads === 0 && <p className="text-slate-600 text-center py-6" style={{ fontSize: 14 }}>Belum ada data upload</p>}
          </div>
        </div>

        {/* Clip stats */}
        {clips.length > 0 && (
          <div className="glass-card overflow-hidden lg:col-span-2">
            <div className="card-header gap-2.5">
              <Sparkles size={15} className="text-indigo-400" />
              <p className="text-label text-slate-300">Analisis Klip Sesi Ini ({clips.length} klip)</p>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {clips.map((c, i) => (
                  <div key={i} className="p-3 rounded-xl text-center" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.13)' }}>
                    <div className={`text-xl font-black mb-0.5 ${c.viralScore > 85 ? 'gradient-text-green' : 'gradient-text-blue'}`} style={{ fontFamily: "'Space Grotesk',sans-serif" }}>
                      {c.viralScore}%
                    </div>
                    <p className="text-slate-500 truncate" style={{ fontSize: 11 }} title={c.title}>{c.title.slice(0, 20)}…</p>
                    <p className="text-indigo-400 font-mono mt-1" style={{ fontSize: 10 }}>{fmtSeconds(c.startTimeSeconds)} – {fmtSeconds(c.endTimeSeconds)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// HELPER COMPONENTS
// ────────────────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { cls: string; dot: string }> = {
    success:    { cls: 'badge-green',  dot: 'bg-emerald-400' },
    detected:   { cls: 'badge-green',  dot: 'bg-emerald-400' },
    pending:    { cls: 'badge-blue',   dot: 'bg-blue-400' },
    processing: { cls: 'badge-amber',  dot: 'bg-amber-400' },
  };
  const c = cfg[status] || { cls: 'badge-red', dot: 'bg-red-400' };
  return (
    <span className={`badge ${c.cls}`} style={{ fontSize: 10.5 }}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot} ${status === 'processing' ? 'animate-pulse' : ''}`} />
      {status?.toUpperCase()}
    </span>
  );
}

function PlatformCell({ platform }: { platform: string }) {
  const cfg: Record<string, { bg: string; icon: React.ReactNode; label: string }> = {
    youtube:   { bg: 'rgba(239,68,68,0.14)',    icon: <Youtube size={15} className="text-red-400" />,     label: 'YouTube' },
    facebook:  { bg: 'rgba(59,130,246,0.14)',   icon: <Facebook size={15} className="text-blue-400" />,   label: 'Facebook' },
    instagram: { bg: 'rgba(236,72,153,0.14)',   icon: <Instagram size={15} className="text-pink-400" />,  label: 'Instagram' },
    tiktok:    { bg: 'rgba(20,184,166,0.14)',   icon: <svg width={15} height={15} fill="currentColor" viewBox="0 0 448 512" className="text-teal-400"><path d="M448,209.91a210.06,210.06,0,0,1-122.77-39.25V349.38A162.55,162.55,0,1,1,185,188.31V278.2a74.62,74.62,0,1,0,38.74,65.8V0h91.56a121.2,121.2,0,0,0,10.66,66.86A123.63,123.63,0,0,0,448,102.73V209.91Z"/></svg>, label: 'TikTok' },
  };
  const c = cfg[platform] || { bg: 'rgba(99,102,241,0.14)', icon: <Globe size={15} className="text-indigo-400" />, label: platform };
  return (
    <div className="flex items-center gap-2.5">
      <div style={{ width: 34, height: 34, borderRadius: 9, background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{c.icon}</div>
      <span className="font-semibold text-slate-300 capitalize" style={{ fontSize: 13.5 }}>{c.label}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// COPY BUTTON
// ────────────────────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={handleCopy} className={`copy-btn ${copied ? 'copied' : ''}`}>
      {copied ? <><Check size={11} />Copied!</> : <><Copy size={11} />Copy</>}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// CAPTION GENERATOR MODAL
// ────────────────────────────────────────────────────────────────────────────
function CaptionModal({ clip, onClose }: { clip: ClipMetadata; onClose: () => void }) {
  const [selectedPlatform, setSelectedPlatform] = useState('tiktok');
  const caption = buildCaption(clip, selectedPlatform);

  const platforms = [
    { id: 'tiktok',     label: 'TikTok',     color: '#14b8a6' },
    { id: 'youtube',    label: 'YouTube',    color: '#ef4444' },
    { id: 'instagram',  label: 'Instagram',  color: '#ec4899' },
    { id: 'facebook',   label: 'Facebook',   color: '#3b82f6' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.93, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.93 }} transition={{ duration: 0.22, ease: [0.23,1,0.32,1] }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl overflow-hidden"
        style={{ background: 'rgba(8,11,28,0.98)', border: '1px solid rgba(99,102,241,0.2)', boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid rgba(99,102,241,0.1)' }}>
          <div className="flex items-center gap-2.5">
            <FileText size={16} className="text-indigo-400" />
            <p className="font-bold text-white" style={{ fontSize: 15 }}>Caption Generator</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-slate-500 font-semibold mb-2" style={{ fontSize: 12.5 }}>Pilih Platform:</p>
            <div className="flex flex-wrap gap-2">
              {platforms.map(p => (
                <button key={p.id} onClick={() => setSelectedPlatform(p.id)}
                  className="px-4 py-2 rounded-xl font-semibold transition-all" style={{ fontSize: 13, background: selectedPlatform === p.id ? `${p.color}22` : 'rgba(99,102,241,0.07)', border: `1px solid ${selectedPlatform === p.id ? p.color + '44' : 'rgba(99,102,241,0.12)'}`, color: selectedPlatform === p.id ? p.color : '#64748b' }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="caption-box">
            <CopyButton text={caption} />
            <pre style={{ marginTop: 4 }}>{caption}</pre>
          </div>
          <div className="flex items-center gap-2 text-slate-500" style={{ fontSize: 12 }}>
            <span className="badge badge-blue">{caption.length} chars</span>
            <span className="badge badge-purple">{clip.tags.length} hashtags</span>
            <span className="badge badge-amber">{clip.viralScore}% viral score</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TRIM EDITOR MODAL
// ────────────────────────────────────────────────────────────────────────────
function TrimModal({ clip, onConfirm, onClose }: {
  clip: ClipMetadata; onConfirm: (start: number, end: number) => void; onClose: () => void;
}) {
  const duration = clip.endTimeSeconds - clip.startTimeSeconds;
  const [start, setStart] = useState(clip.startTimeSeconds);
  const [end, setEnd]     = useState(clip.endTimeSeconds);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.93, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.93 }} transition={{ duration: 0.22, ease: [0.23,1,0.32,1] }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl overflow-hidden"
        style={{ background: 'rgba(8,11,28,0.98)', border: '1px solid rgba(99,102,241,0.2)', boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid rgba(99,102,241,0.1)' }}>
          <div className="flex items-center gap-2.5">
            <Scissors size={16} className="text-indigo-400" />
            <p className="font-bold text-white" style={{ fontSize: 15 }}>Trim Editor</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-5">
          <div className="p-4 rounded-xl text-center" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)' }}>
            <p className="text-white font-bold" style={{ fontSize: 14.5 }} title={clip.title}>{clip.title}</p>
            <p className="text-slate-500 mt-0.5" style={{ fontSize: 12.5 }}>Original: {fmtSeconds(clip.startTimeSeconds)} – {fmtSeconds(clip.endTimeSeconds)} ({Math.round(duration)}s)</p>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-label text-slate-400">Start Time</label>
                <span className="text-indigo-400 font-mono font-bold" style={{ fontSize: 14 }}>{fmtSeconds(start)}</span>
              </div>
              <input type="range" min={clip.startTimeSeconds} max={end - 1} step={0.5} value={start}
                onChange={e => setStart(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#6366f1' }} />
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-label text-slate-400">End Time</label>
                <span className="text-indigo-400 font-mono font-bold" style={{ fontSize: 14 }}>{fmtSeconds(end)}</span>
              </div>
              <input type="range" min={start + 1} max={clip.endTimeSeconds + 60} step={0.5} value={end}
                onChange={e => setEnd(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#6366f1' }} />
            </div>
          </div>
          <div className="flex items-center justify-between p-3.5 rounded-xl" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}>
            <span className="text-slate-400 font-semibold" style={{ fontSize: 13 }}>Durasi baru:</span>
            <span className="text-emerald-400 font-bold font-mono" style={{ fontSize: 16 }}>{Math.round(end - start)}s</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={onClose} className="btn-ghost" style={{ padding: '12px', fontSize: 14 }}>Batal</button>
            <button onClick={() => { onConfirm(start, end); onClose(); }} className="btn-primary" style={{ padding: '12px', fontSize: 14 }}>
              <Scissors size={15} /> Terapkan Trim
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// CLIP CARD
// ────────────────────────────────────────────────────────────────────────────
function ClipCard({ clip: initialClip, index, originalUrl, quality, useSubtitles, captionStyle, videoMode, isYoutubeConnected, subFontName, subFontSize, subHighlightColor, onActionSuccess, authedFetch, showToast }: {
  clip: ClipMetadata; index: number; originalUrl: string; quality: string;
  useSubtitles: boolean; captionStyle: 'normal' | 'tiktok'; videoMode: 'reframe' | 'center' | 'split';
  isYoutubeConnected: boolean; subFontName?: string; subFontSize?: number; subHighlightColor?: string;
  onActionSuccess: () => void; authedFetch: any;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [clip, setClip]             = useState(initialClip);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading]     = useState(false);
  const [thumbnailUrl, setThumbnailUrl]   = useState<string | null>(null);
  const [isThumbLoading, setIsThumbLoading] = useState(false);
  const [showSchedule, setShowSchedule]   = useState(false);
  const [showCaptions, setShowCaptions]   = useState(false);
  const [showTrim, setShowTrim]           = useState(false);
  const [schedulePlatform, setSchedulePlatform] = useState('youtube');
  const [scheduleDateTime, setScheduleDateTime] = useState('');
  const [isScheduling, setIsScheduling]   = useState(false);
  const [expanded, setExpanded]           = useState(false);
  const ytId = getYouTubeId(originalUrl);

  const handleGenerateThumbnail = async () => {
    setIsThumbLoading(true);
    try {
      const frameRes = await authedFetch(`/api/thumbnail/extract?url=${encodeURIComponent(originalUrl)}&time=${clip.startTimeSeconds + 1}`);
      if (!frameRes) return;
      const blob = await frameRes.blob();
      const frameUrl = URL.createObjectURL(blob);
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = frameUrl;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      canvas.width = 1080; canvas.height = 1920;
      ctx.drawImage(img, 0, 0, 1080, 1920);
      const g = ctx.createLinearGradient(0, 0, 0, 1920);
      g.addColorStop(0, 'rgba(0,0,0,0.72)'); g.addColorStop(0.28, 'rgba(0,0,0,0)');
      g.addColorStop(0.78, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.82)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1920);
      const words = clip.hook.toUpperCase().split(' ');
      ctx.font = 'bold 92px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 16;
      let y = 1920 * 0.18;
      words.forEach((w, i) => {
        const line = words.slice(Math.floor(i / 3) * 3, Math.floor(i / 3) * 3 + 3).join(' ');
        if (i % 3 === 0) { ctx.strokeText(line, 540, y); ctx.fillStyle = '#fde047'; ctx.fillText(line, 540, y); y += 110; }
      });
      setThumbnailUrl(canvas.toDataURL('image/jpeg', 0.92));
      showToast('Thumbnail berhasil dibuat!', 'success');
    } catch { showToast('Gagal membuat thumbnail.', 'error'); }
    finally { setIsThumbLoading(false); }
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await authedFetch(`/api/download-clip?url=${encodeURIComponent(originalUrl)}&start=${clip.startTimeSeconds}&end=${clip.endTimeSeconds}&format=${clip.aspectRatio}&quality=${quality}&useSubtitles=${useSubtitles}&captionStyle=${captionStyle}&videoMode=${videoMode}&subFontName=${subFontName || ''}&subFontSize=${subFontSize || ''}&subHighlightColor=${subHighlightColor || ''}`);
      if (!response?.ok) { const e = await response?.json(); throw new Error(e?.error || 'Gagal download'); }
      const blob = await response.blob();
      const u = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = u;
      a.download = `viral_clip_${clip.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp4`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(u);
      showToast('Video berhasil didownload!', 'success'); onActionSuccess();
    } catch (e: any) { showToast('Gagal mendownload video.', 'error'); }
    finally { setIsDownloading(false); }
  };

  const handleUpload = async (platform: string) => {
    if (platform === 'youtube' && !isYoutubeConnected) { showToast('Hubungkan YouTube terlebih dahulu!', 'error'); return; }
    setIsUploading(true);
    try {
      const res = await authedFetch(`/api/upload/${platform}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: originalUrl, start: clip.startTimeSeconds, end: clip.endTimeSeconds, title: clip.title, description: clip.description, tags: clip.tags, format: clip.aspectRatio, useSubtitles, captionStyle, videoMode, subFontName, subFontSize, subHighlightColor })
      });
      if (!res?.ok) { const e = await res?.json(); throw new Error(e?.error || 'Gagal upload'); }
      const r = await res.json();
      showToast(`Berhasil upload ke ${platform}! (${r.videoId})`, 'success'); onActionSuccess();
    } catch (e: any) { showToast(`Gagal upload: ${e.message}`, 'error'); }
    finally { setIsUploading(false); }
  };

  const handleUploadAll = async () => {
    showToast('Memulai upload ke semua platform...', 'info');
    for (const platform of ['youtube', 'facebook', 'instagram', 'tiktok']) {
      await handleUpload(platform);
      await new Promise(r => setTimeout(r, 600));
    }
  };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleDateTime) { showToast('Pilih tanggal dan waktu', 'error'); return; }
    if (new Date(scheduleDateTime).getTime() <= Date.now()) { showToast('Waktu harus di masa depan', 'error'); return; }
    setIsScheduling(true);
    try {
      const res = await authedFetch('/api/scheduler/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: originalUrl, start: clip.startTimeSeconds, end: clip.endTimeSeconds, title: clip.title, description: clip.description, tags: clip.tags, format: clip.aspectRatio, useSubtitles, captionStyle, videoMode, scheduledTime: new Date(scheduleDateTime).getTime(), platform: schedulePlatform, subFontName, subFontSize, subHighlightColor })
      });
      if (!res?.ok) { const e = await res?.json().catch(() => ({})); throw new Error(e?.error || 'Gagal jadwalkan'); }
      showToast('Berhasil dijadwalkan!', 'success'); setShowSchedule(false); onActionSuccess();
    } catch (e: any) { showToast(e.message || 'Gagal menjadwalkan', 'error'); }
    finally { setIsScheduling(false); }
  };

  return (
    <>
      <motion.div initial={{ opacity: 0, scale: 0.94, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: index * 0.07, duration: 0.3, ease: [0.23,1,0.32,1] }}
        className="clip-card">
        {/* Video preview */}
        <div className={`${clip.aspectRatio === 'landscape' ? 'aspect-video' : 'aspect-[9/16] max-h-[340px]'} relative overflow-hidden flex-shrink-0 flex items-center justify-center`}
          style={{ background: '#050811' }}>
          {ytId ? (
            <iframe src={`https://www.youtube-nocookie.com/embed/${ytId}?start=${clip.startTimeSeconds}&end=${clip.endTimeSeconds}&rel=0`}
              className="w-full h-full" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowFullScreen />
          ) : (
            <>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.22)' }}>
                  <PlaySquare size={26} className="text-indigo-400 ml-1" />
                </div>
              </div>
              <div className="absolute bottom-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono" style={{ background: 'rgba(6,9,22,0.92)', border: '1px solid rgba(99,102,241,0.22)', color: '#818cf8', fontSize: 11.5 }}>
                <Clock size={11} /> {clip.timestamps}
              </div>
            </>
          )}
          {/* Viral score */}
          <div className={`absolute top-3 right-3 viral-score ${clip.viralScore > 85 ? 'score-high' : clip.viralScore > 70 ? 'score-med' : 'score-low'}`}>
            <TrendingUp size={11} /> {clip.viralScore}%
          </div>
          {/* Clip # badge */}
          <div className="absolute top-3 left-3 w-7 h-7 rounded-lg flex items-center justify-center font-bold"
            style={{ background: 'rgba(6,9,22,0.88)', border: '1px solid rgba(99,102,241,0.22)', color: '#818cf8', fontSize: 11 }}>
            {index + 1}
          </div>
          {/* Bottom gradient */}
          <div className="absolute inset-x-0 bottom-0 h-14 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(10,14,32,0.95), transparent)' }} />
        </div>

        {/* Body */}
        <div className="flex flex-col flex-1 p-4">
          <div className="flex items-start justify-between gap-2 mb-3">
            <h4 className="font-bold text-white leading-tight flex-1" style={{ fontSize: 14.5 }} title={clip.title}>
              {clip.title}
            </h4>
            <button onClick={() => setExpanded(!expanded)} className="text-slate-600 hover:text-slate-300 transition-colors flex-shrink-0 mt-0.5">
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>

          {/* Hook */}
          <div className="p-3.5 rounded-xl mb-3" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.16)' }}>
            <p className="text-label text-indigo-400 mb-1.5">🎣 AI Hook</p>
            <p className="italic text-slate-300" style={{ fontSize: 13 }}>"{clip.hook}"</p>
          </div>

          {/* Expandable content */}
          <AnimatePresence>
            {expanded && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="space-y-3 mb-3">
                  <p className="text-slate-500 leading-relaxed" style={{ fontSize: 13 }}>{clip.description}</p>
                  {clip.viralAnalysis && (
                    <div className="p-3 rounded-xl" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.14)' }}>
                      <p className="text-label text-emerald-400 mb-1.5">📊 Viral Analysis</p>
                      <p className="text-slate-500" style={{ fontSize: 12.5 }}>{clip.viralAnalysis}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 rounded-lg" style={{ background: 'rgba(99,102,241,0.07)' }}>
                      <p className="text-label text-slate-600 mb-0.5">Start</p>
                      <p className="font-mono font-bold text-indigo-400" style={{ fontSize: 13 }}>{fmtSeconds(clip.startTimeSeconds)}</p>
                    </div>
                    <div className="p-2 rounded-lg" style={{ background: 'rgba(99,102,241,0.07)' }}>
                      <p className="text-label text-slate-600 mb-0.5">End</p>
                      <p className="font-mono font-bold text-indigo-400" style={{ fontSize: 13 }}>{fmtSeconds(clip.endTimeSeconds)}</p>
                    </div>
                    <div className="p-2 rounded-lg" style={{ background: 'rgba(99,102,241,0.07)' }}>
                      <p className="text-label text-slate-600 mb-0.5">Durasi</p>
                      <p className="font-mono font-bold text-purple-400" style={{ fontSize: 13 }}>{Math.round(clip.endTimeSeconds - clip.startTimeSeconds)}s</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mb-4 mt-auto">
            {clip.tags.slice(0, 4).map(tag => (
              <span key={tag} className="tag-chip"><Hash size={9} />{tag.replace('#', '')}</span>
            ))}
            {clip.tags.length > 4 && <span className="tag-chip">+{clip.tags.length - 4}</span>}
          </div>

          {/* Primary actions */}
          <div className="flex items-center gap-2" style={{ paddingTop: 12, borderTop: '1px solid rgba(99,102,241,0.1)' }}>
            <button onClick={handleDownload} disabled={isDownloading} id={`download-${index}`}
              className="btn-primary flex-1" style={{ padding: '10px 14px', fontSize: 13.5, borderRadius: 11 }}>
              {isDownloading ? <div className="spinner" style={{ width: 16, height: 16 }} /> : <Download size={14} />}
              {isDownloading ? 'Downloading...' : 'Download'}
            </button>

            {/* Feature buttons */}
            <div className="flex gap-1.5 flex-wrap">
              {/* Caption Generator */}
              <button onClick={() => setShowCaptions(true)} title="Caption Generator" className="platform-btn"
                style={{ background: 'rgba(99,102,241,0.13)', border: '1px solid rgba(99,102,241,0.22)', color: '#818cf8' }}>
                <FileText size={15} />
              </button>
              {/* Trim Editor */}
              <button onClick={() => setShowTrim(true)} title="Trim Editor" className="platform-btn"
                style={{ background: 'rgba(168,85,247,0.13)', border: '1px solid rgba(168,85,247,0.22)', color: '#c084fc' }}>
                <Scissors size={15} />
              </button>
              {/* Thumbnail */}
              <button onClick={handleGenerateThumbnail} disabled={isThumbLoading} title="Generate Thumbnail" className="platform-btn"
                style={{ background: 'rgba(245,158,11,0.13)', border: '1px solid rgba(245,158,11,0.22)', color: '#fbbf24' }}>
                {isThumbLoading ? <div className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fbbf24' }} /> : <Sparkles size={15} />}
              </button>
            </div>
          </div>

          {/* Upload section */}
          <div className="mt-3 space-y-2.5">
            {/* Upload-all button */}
            <button onClick={handleUploadAll} disabled={isUploading}
              className="btn-secondary w-full" style={{ fontSize: 13, padding: '10px', borderRadius: 10 }}>
              {isUploading ? <div className="spinner" style={{ width: 15, height: 15 }} /> : <Upload size={14} />}
              {isUploading ? 'Uploading...' : '🚀 Upload ke Semua Platform'}
            </button>

            {/* Individual platform buttons */}
            <div className="grid grid-cols-5 gap-1.5">
              {[
                { p: 'youtube', title: 'YouTube Shorts', bg: 'rgba(239,68,68,0.14)', bc: 'rgba(239,68,68,0.25)', color: '#f87171', icon: <Youtube size={14} /> },
                { p: 'facebook', title: 'Facebook Page', bg: 'rgba(59,130,246,0.14)', bc: 'rgba(59,130,246,0.25)', color: '#60a5fa', icon: <Facebook size={14} /> },
                { p: 'instagram', title: 'Instagram Reels', bg: 'rgba(236,72,153,0.14)', bc: 'rgba(236,72,153,0.25)', color: '#f472b6', icon: <Instagram size={14} /> },
                { p: 'tiktok', title: 'TikTok', bg: 'rgba(20,184,166,0.14)', bc: 'rgba(20,184,166,0.25)', color: '#2dd4bf', icon: <svg width={14} height={14} fill="currentColor" viewBox="0 0 448 512"><path d="M448,209.91a210.06,210.06,0,0,1-122.77-39.25V349.38A162.55,162.55,0,1,1,185,188.31V278.2a74.62,74.62,0,1,0,38.74,65.8V0h91.56a121.2,121.2,0,0,0,10.66,66.86A123.63,123.63,0,0,0,448,102.73V209.91Z"/></svg> },
                { p: '', title: 'Jadwalkan', bg: 'rgba(99,102,241,0.14)', bc: showSchedule ? 'rgba(99,102,241,0.5)' : 'rgba(99,102,241,0.25)', color: '#818cf8', icon: <Clock size={14} />, action: () => setShowSchedule(!showSchedule) },
              ].map((btn, i) => (
                <button key={i} onClick={btn.action || (() => handleUpload(btn.p))}
                  disabled={isUploading && !!btn.p} title={btn.title}
                  className="platform-btn" style={{ width: '100%', background: btn.bg, border: `1px solid ${btn.bc}`, color: btn.color }}>
                  {btn.icon}
                </button>
              ))}
            </div>
          </div>

          {/* Schedule form */}
          <AnimatePresence>
            {showSchedule && (
              <motion.form onSubmit={handleScheduleSubmit}
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 pt-3 space-y-3 overflow-hidden" style={{ borderTop: '1px solid rgba(99,102,241,0.1)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-label text-indigo-400 flex items-center gap-1.5"><Clock size={12} /> Jadwalkan Posting</span>
                  <button type="button" onClick={() => setShowSchedule(false)} className="text-slate-600 hover:text-slate-300"><X size={14} /></button>
                </div>
                <select value={schedulePlatform} onChange={e => setSchedulePlatform(e.target.value)} className="input-modern" style={{ fontSize: 13.5 }}>
                  <option value="youtube">YouTube Shorts</option>
                  <option value="facebook">Facebook Page</option>
                  <option value="instagram">Instagram Reels</option>
                  <option value="tiktok">TikTok</option>
                </select>
                <input type="datetime-local" value={scheduleDateTime} onChange={e => setScheduleDateTime(e.target.value)} className="input-modern" style={{ fontSize: 13.5 }} />
                <button type="submit" disabled={isScheduling} className="btn-primary w-full" style={{ borderRadius: 11, padding: '11px', fontSize: 13.5 }}>
                  {isScheduling ? <div className="spinner" style={{ width: 16, height: 16 }} /> : <Clock size={14} />}
                  {isScheduling ? 'Menyimpan...' : 'Konfirmasi Jadwal'}
                </button>
              </motion.form>
            )}
          </AnimatePresence>

          {/* Thumbnail preview */}
          <AnimatePresence>
            {thumbnailUrl && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }} className="mt-3 pt-3 overflow-hidden" style={{ borderTop: '1px solid rgba(99,102,241,0.1)' }}>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-label text-amber-400 flex items-center gap-1.5"><Sparkles size={11} /> Viral Thumbnail</span>
                  <button onClick={() => setThumbnailUrl(null)} className="text-slate-600 hover:text-slate-300"><X size={13} /></button>
                </div>
                <div className="relative rounded-xl overflow-hidden mb-2.5 aspect-[9/16]" style={{ border: '1px solid rgba(99,102,241,0.16)' }}>
                  <img src={thumbnailUrl} className="w-full h-full object-cover" alt="Thumbnail" />
                </div>
                <button onClick={() => { const l = document.createElement('a'); l.download = `thumb-${clip.title}.jpg`; l.href = thumbnailUrl; l.click(); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold transition-all" style={{ background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24', fontSize: 13.5 }}>
                  <Download size={13} /> Download Thumbnail
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Caption Modal */}
      <AnimatePresence>
        {showCaptions && <CaptionModal clip={clip} onClose={() => setShowCaptions(false)} />}
      </AnimatePresence>

      {/* Trim Modal */}
      <AnimatePresence>
        {showTrim && (
          <TrimModal clip={clip}
            onConfirm={(start, end) => setClip(prev => ({ ...prev, startTimeSeconds: start, endTimeSeconds: end, timestamps: `${fmtSeconds(start)} - ${fmtSeconds(end)}` }))}
            onClose={() => setShowTrim(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
