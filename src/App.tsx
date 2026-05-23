import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Login } from './Login';
import {
  Plus,
  Trash2,
  Download,
  Settings,
  History,
  Zap,
  CheckCircle,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Youtube,
  Menu,
  X,
  Smartphone,
  Monitor,
  Video,
  Clock,
  Sparkles,
  Search,
  TrendingUp,
  Hash,
  PlaySquare,
  Link as LinkIcon,
  LogOut,
  ChevronRight
} from 'lucide-react';
import { generateViralClips, type ClipMetadata } from './services/geminiService';
import { SettingsModal } from './SettingsModal';
import { LicenseScreen } from './LicenseScreen';

function getYouTubeId(url: string) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

const LOADING_STEPS = [
  "Menganalisis URL video...",
  "Mencari momen paling menarik...",
  "Menyusun hook yang bikin penasaran...",
  "Menulis deskripsi & hashtag viral...",
  "Menyiapkan resolusi video untuk TikTok, Reels & Shorts..."
];

export default function App() {
  const [url, setUrl] = useState(() => sessionStorage.getItem('viralclip_url') || '');
  const [format, setFormat] = useState<'portrait' | 'landscape'>('portrait');
  const [count, setCount] = useState<number>(4);
  const [quality, setQuality] = useState('720p');
  const [useSubtitles, setUseSubtitles] = useState(false);  // Default: TANPA subtitle
  const [captionStyle, setCaptionStyle] = useState<'normal' | 'tiktok'>('normal');  // Default: normal (bukan tiktok)
  const [videoMode, setVideoMode] = useState<'reframe' | 'center' | 'split'>('reframe');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [clips, setClips] = useState<ClipMetadata[]>(() => {
    const saved = sessionStorage.getItem('viralclip_clips');
    return saved ? JSON.parse(saved) : [];
  });
  const [error, setError] = useState<string | null>(null);
  const [isYoutubeConnected, setIsYoutubeConnected] = useState(false);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [watchedChannels, setWatchedChannels] = useState<string[]>([]);
  const [newChannelId, setNewChannelId] = useState('');
  const [watcherStatus, setWatcherStatus] = useState<any>({ isChecking: false, logs: [], lastAction: 'Idle' });
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' | 'info' }[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };

  useEffect(() => {
    sessionStorage.setItem('viralclip_clips', JSON.stringify(clips));
  }, [clips]);

  useEffect(() => {
    sessionStorage.setItem('viralclip_url', url);
  }, [url]);

  // Auth State
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<any>(JSON.parse(localStorage.getItem('user') || 'null'));
  const [isLicensed, setIsLicensed] = useState(false);
  const [checkingLicense, setCheckingLicense] = useState(true);

  useEffect(() => {
    checkLicense();
  }, []);

  const checkLicense = async () => {
    try {
      const res = await fetch('/api/license/status');
      const data = await res.json();
      if (data.valid) {
        setIsLicensed(true);
      } else {
        setIsLicensed(false);
      }
    } catch (e) {
      console.error('License check failed:', e);
      setIsLicensed(false);
    } finally {
      setCheckingLicense(false);
    }
  };

  const handleLogin = (newToken: string, newUser: any) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  const authedFetch = async (url: string, options: any = {}) => {
    if (!token) return null;
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    };
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      handleLogout();
      return null;
    }
    return response;
  };

  const fetchStatus = async () => {
    try {
      const res = await authedFetch('/api/v2/watcher/status');
      if (!res) return;
      const data = await res.json();
      setWatcherStatus(data);
    } catch (e) {
      console.error("Error fetching status:", e);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await authedFetch('/api/history');
      if (!res) return;
      if (res.status === 401) return handleLogout();
      const data = await res.json();
      setHistoryData(data);
    } catch (e) {
      console.error("Failed to fetch history:", e);
    }
  };

  const fetchWatchedChannels = async () => {
    try {
      const res = await authedFetch('/api/v2/watcher/list');
      if (!res) return;
      const data = await res.json();
      setWatchedChannels(data);
    } catch (e) {
      console.error("Failed to fetch watched channels:", e);
    }
  };

  useEffect(() => {
    if (!token) return;

    // Check YouTube connection status
    authedFetch('/api/auth/status')
      .then(r => r?.json())
      .then(data => {
        if (data) setIsYoutubeConnected(data.connected);
      })
      .catch(e => {
        console.error("Auth status check failed:", e);
        // Do not handleLogout here! If server restarts, this will be a network error, not an auth error.
      });

    // Check if redirecting from successful connection
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'youtube') {
      setIsYoutubeConnected(true);
      window.history.replaceState({}, '', window.location.pathname);
    }

    fetchHistory();
    fetchWatchedChannels();
    fetchStatus();

    const interval = setInterval(() => {
      fetchHistory();
      fetchStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelId) return;
    try {
      await authedFetch('/api/v2/watcher/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: newChannelId })
      });
      setNewChannelId('');
      fetchWatchedChannels();
      alert("Channel berhasil ditambahkan ke pemantauan otomatis!");
    } catch (e) {
      console.error("Failed to add channel:", e);
    }
  };

  const handleConnectYoutube = async () => {
    try {
      const res = await authedFetch('/api/auth/youtube');
      if (!res) return;
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (e) {
      console.error("Failed to connect YouTube:", e);
    }
  };

  const handleRemoveChannel = async (id: string) => {
    try {
      await authedFetch('/api/v2/watcher/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: id })
      });
      fetchWatchedChannels();
    } catch (e) {
      console.error("Failed to remove channel:", e);
    }
  };

  const handleRunWatcher = async () => {
    try {
      showToast("Triggering watcher...", "info");
      const res = await authedFetch('/api/v2/watcher/run', { method: 'POST' });
      if (res && res.ok) {
        showToast("Watcher dipicu! Cek log Live Activity.", "success");
        fetchStatus();
      } else {
        showToast("Watcher mungkin sudah berjalan atau terjadi error.", "error");
      }
    } catch (e) {
      console.error("Failed to run watcher:", e);
      showToast("Gagal memicu watcher.", "error");
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setError(null);
    setIsGenerating(true);
    setClips([]);

    try {
      const res = await authedFetch(`/api/video-info?url=${encodeURIComponent(url)}`);
      if (!res) return;
      if (!res.ok) throw new Error('Gagal mengambil informasi video');

      const videoInfo = await res.json();

      const transcriptRes = await authedFetch(`/api/transcript?url=${encodeURIComponent(url)}`);
      let transcriptText = "";
      if (transcriptRes && transcriptRes.ok) {
        const tData = await transcriptRes.json();
        transcriptText = tData.transcript;
      }

      const results = await generateViralClips(url, format, videoInfo, transcriptText, count);
      setClips(results);
    } catch (err: any) {
      setError(err.message || "Gagal menghasilkan klip. Pastikan API key sudah diset dan kuota mencukupi.");
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  if (checkingLicense) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isLicensed) {
    return <LicenseScreen onSuccess={() => setIsLicensed(true)} />;
  }

  if (!token) return <Login onLogin={handleLogin} />;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 selection:bg-blue-500/30">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,0.08),transparent_50%)] pointer-events-none" />

      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              className={`px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 backdrop-blur-xl border border-white/10 ${toast.type === 'error' ? 'bg-red-500/80 text-white' : toast.type === 'success' ? 'bg-green-500/80 text-white' : 'bg-blue-500/80 text-white'}`}
            >
              {toast.type === 'error' ? <AlertCircle size={20} /> : toast.type === 'success' ? <CheckCircle size={20} /> : <Zap size={20} />}
              <p className="text-sm font-bold tracking-wide">{toast.message}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <header className="sticky top-0 z-50 backdrop-blur-md border-b border-white/5 bg-slate-950/50">
        <div className="container mx-auto px-4 h-16 md:h-20 flex items-center justify-between gap-3">

          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-9 h-9 md:w-10 md:h-10 bg-gradient-to-tr from-blue-600 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-600/20 flex-shrink-0">
              <Zap size={20} fill="currentColor" />
            </div>
            <div>
              <h1 className="text-base md:text-xl font-black text-white tracking-tight">ViralClip AI</h1>
              <p className="text-[9px] md:text-[10px] text-slate-500 uppercase tracking-widest font-bold">Autopilot Mode</p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-xs text-slate-400 font-medium truncate max-w-[140px]">{user?.email}</p>
              <button onClick={handleLogout} className="text-[10px] text-red-400 font-bold uppercase hover:text-red-300 flex items-center gap-1 ml-auto">
                <LogOut size={10} /> Logout
              </button>
            </div>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 md:p-2.5 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-all border border-slate-800"
            >
              <Settings size={18} />
            </button>
            <button
              onClick={handleConnectYoutube}
              className={`flex items-center gap-1.5 px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-bold transition-all ${isYoutubeConnected
                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20'
                }`}
            >
              <Youtube size={16} />
              <span className="hidden xs:inline sm:inline">{isYoutubeConnected ? 'Connected' : 'Connect YT'}</span>
            </button>
            {/* Mobile logout */}
            <button onClick={handleLogout} className="sm:hidden text-red-400 hover:text-red-300 p-1">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 md:py-12">
        <div className="text-center mb-10 md:mb-16">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl lg:text-7xl font-black mb-4 md:mb-6 tracking-tight leading-[1.1]"
          >
            Ubah Video Apapun <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-orange-400 to-blue-400 animate-gradient">
              Menjadi Konten Viral
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-slate-400 text-base md:text-lg lg:text-xl max-w-2xl mx-auto font-medium px-2"
          >
            Gunakan AI kelas dunia untuk memotong, menganalisis, dan menjadwalkan konten viral Anda dalam hitungan detik.
          </motion.p>
        </div>

        <div className="max-w-3xl mx-auto mb-16 md:mb-20">
          <div className="bg-white/5 border border-white/10 p-4 md:p-8 rounded-[1.5rem] md:rounded-[2rem] backdrop-blur-2xl shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
              <Sparkles className="w-24 h-24 text-purple-500" />
            </div>

            <form onSubmit={handleGenerate} className="space-y-6 relative z-10">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Paste YouTube or Social Media URL..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full bg-slate-900/50 border border-slate-700/50 text-white rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10 transition-all text-lg placeholder:text-slate-600"
                />
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
              </div>

              {/* Row 1: Format */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Pilih Format</label>
                <div className="flex bg-slate-900/50 p-1 rounded-xl border border-slate-700/50">
                  <button
                    type="button"
                    onClick={() => setFormat('portrait')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm transition-all ${format === 'portrait' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-slate-400 hover:text-white'}`}
                  >
                    <Smartphone size={16} />
                    <span>Portrait (Shorts/Reels)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormat('landscape')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm transition-all ${format === 'landscape' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:text-white'}`}
                  >
                    <Monitor size={16} />
                    <span>Landscape (YouTube)</span>
                  </button>
                </div>
              </div>

              {/* Row 2: Jumlah Klip + Kualitas */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Jumlah Klip</label>
                  <select
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 text-white px-4 py-2.5 rounded-xl outline-none focus:border-orange-500 transition-colors"
                  >
                    <option value={4}>4 Klip</option>
                    <option value={8}>8 Klip</option>
                    <option value={12}>12 Klip</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Kualitas Video</label>
                  <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-white px-4 py-2.5 rounded-xl outline-none focus:border-orange-500 transition-colors"
                  >
                    <option value="360p">360p</option>
                    <option value="480p">480p</option>
                    <option value="720p">720p (Rekomendasi)</option>
                    <option value="1080p">1080p (HD)</option>
                  </select>
                </div>
              </div>

              {/* Row 3: AI Options */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Caption</label>
                  <button
                    type="button"
                    onClick={() => setUseSubtitles(!useSubtitles)}
                    className={`w-full h-[44px] px-4 rounded-xl border font-bold transition-all flex items-center gap-2 text-sm ${useSubtitles ? 'bg-purple-600/20 border-purple-500/50 text-purple-300' : 'bg-slate-900/50 border-slate-700/50 text-slate-500'}`}
                  >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${useSubtitles ? 'bg-purple-400 animate-pulse' : 'bg-slate-600'}`} />
                    {useSubtitles ? 'Ada Subtitle' : 'Tanpa Sub'}
                  </button>
                </div>

                {useSubtitles && (
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Gaya Caption</label>
                    <div className="flex bg-slate-900/50 p-1 rounded-xl border border-slate-700/50 h-[44px]">
                      <button type="button" onClick={() => setCaptionStyle('tiktok')}
                        className={`flex-1 rounded-lg text-xs font-bold transition-all ${captionStyle === 'tiktok' ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/20' : 'text-slate-400 hover:text-white'}`}>
                        🔥 TikTok
                      </button>
                      <button type="button" onClick={() => setCaptionStyle('normal')}
                        className={`flex-1 rounded-lg text-xs font-bold transition-all ${captionStyle === 'normal' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                        Normal
                      </button>
                    </div>
                  </div>
                )}

                {format === 'portrait' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Mode Video</label>
                    <div className="flex bg-slate-900/50 p-1 rounded-xl border border-slate-700/50 h-[44px]">
                      <button type="button" onClick={() => setVideoMode('reframe')}
                        className={`flex-1 rounded-lg text-xs font-bold transition-all ${videoMode === 'reframe' ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20' : 'text-slate-400 hover:text-white'}`}>
                        😊 AI Reframe
                      </button>
                      <button type="button" onClick={() => setVideoMode('center')}
                        className={`flex-1 rounded-lg text-xs font-bold transition-all ${videoMode === 'center' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                        Center
                      </button>
                      <button type="button" onClick={() => setVideoMode('split')}
                        className={`flex-1 rounded-lg text-[10px] font-bold transition-all ${videoMode === 'split' ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/20' : 'text-slate-400 hover:text-white'}`}>
                        Split Screen
                      </button>
                    </div>
                  </div>
                )}
              </div>




              <button
                type="submit"
                disabled={isGenerating || !url}
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:from-slate-800 disabled:to-slate-800 text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-purple-500/20 flex items-center justify-center gap-3 text-lg"
              >
                {isGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Menganalisis Konten...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={22} className="text-orange-400" />
                    <span>GENERATE VIRAL CLIPS</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {error && (
          <div className="max-w-2xl mx-auto mb-8 bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl flex items-center gap-3">
            <AlertCircle size={20} />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        <AnimatePresence>
          {clips.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-8">

              {clips.map((clip, index) => (
                // @ts-ignore
                <ClipCard
                  key={index}
                  clip={clip}
                  index={index}
                  originalUrl={url}
                  quality={quality}
                  useSubtitles={useSubtitles}
                  captionStyle={captionStyle}
                  videoMode={videoMode}
                  isYoutubeConnected={isYoutubeConnected}
                  onActionSuccess={fetchHistory}
                  authedFetch={authedFetch}
                  showToast={showToast}
                />


              ))}
            </div>
          )}
        </AnimatePresence>

        <div className="mt-16 md:mt-24">
          <div className="flex items-center gap-3 mb-6 md:mb-8">
            <div className="w-9 h-9 md:w-10 md:h-10 bg-orange-500/20 rounded-xl flex items-center justify-center text-orange-400 shadow-lg shadow-orange-500/10">
              <Zap size={20} />
            </div>
            <h2 className="text-xl md:text-3xl font-black text-white">Auto-Pilot Channel Watcher</h2>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-[1.5rem] md:rounded-[2rem] p-4 md:p-8 backdrop-blur-2xl">
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 md:gap-12">
              <div>
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <Plus size={20} className="text-purple-400" />
                  Tambah Channel
                </h3>
                <p className="text-slate-400 text-sm mb-6">
                  Masukkan ID Channel YouTube. Sistem akan memantau postingan baru setiap 5 menit.
                </p>
                <form onSubmit={handleAddChannel} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Channel ID..."
                    value={newChannelId}
                    onChange={(e) => setNewChannelId(e.target.value)}
                    className="flex-1 bg-slate-900/50 border border-slate-700/50 text-white rounded-xl px-4 py-3 outline-none focus:border-purple-500 transition-all font-mono text-sm"
                  />
                  <button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-3 rounded-xl font-bold transition-all">
                    Add
                  </button>
                </form>
              </div>

              <div>
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <CheckCircle size={20} className="text-green-400" />
                  Daftar Pangkalan
                </h3>
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                  {watchedChannels.length === 0 ? (
                    <div className="text-slate-500 text-sm italic py-8 border border-dashed border-white/10 rounded-xl text-center">
                      Kosong.
                    </div>
                  ) : (
                    watchedChannels.map(id => (
                      <div key={id} className="flex items-center justify-between bg-white/5 p-4 rounded-xl border border-white/5 group">
                        <div className="flex items-center gap-3">
                          <Video size={16} className="text-slate-400" />
                          <span className="font-mono text-sm text-slate-300">{id}</span>
                        </div>
                        <button
                          onClick={() => handleRemoveChannel(id)}
                          className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold flex items-center gap-2 text-orange-400">
                    <Zap size={20} />
                    Live Activity
                  </h3>
                  <button
                    onClick={handleRunWatcher}
                    disabled={watcherStatus.isChecking}
                    className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <PlaySquare size={14} />
                    Run Now
                  </button>
                </div>
                <div className="bg-slate-950/50 p-6 rounded-2xl border border-white/5 font-mono text-[11px] h-[300px] flex flex-col">
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/5">
                    <span className="text-slate-500">Status:</span>
                    <span className={`flex items-center gap-1.5 ${watcherStatus.isChecking ? 'text-orange-400' : 'text-green-400'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${watcherStatus.isChecking ? 'bg-orange-400' : 'bg-green-400'}`} />
                      {watcherStatus.isChecking ? 'RUNNING' : 'WAITING'}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 text-slate-400">
                    {watcherStatus.logs?.length === 0 && <p className="text-slate-600 italic">No activity yet...</p>}
                    {watcherStatus.logs?.map((log: string, i: number) => (
                      <div key={i} className="border-l border-white/10 pl-2 py-0.5 leading-relaxed">{log}</div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-16 md:mt-24">
          <div className="flex items-center gap-3 mb-6 md:mb-8">
            <div className="w-9 h-9 md:w-10 md:h-10 bg-purple-500/20 rounded-xl flex items-center justify-center text-purple-400 shadow-lg shadow-purple-500/10">
              <History size={20} />
            </div>
            <h2 className="text-xl md:text-3xl font-black text-white">Activity History</h2>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-[1.5rem] md:rounded-[2rem] overflow-hidden backdrop-blur-2xl shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/5 border-b border-white/5">
                    <th className="px-3 md:px-6 py-4 md:py-5 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Aktivitas</th>
                    <th className="px-3 md:px-6 py-4 md:py-5 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Video / Klip</th>
                    <th className="px-3 md:px-6 py-4 md:py-5 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">Waktu</th>
                    <th className="px-3 md:px-6 py-4 md:py-5 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Status</th>
                    <th className="px-3 md:px-6 py-4 md:py-5 text-xs font-bold text-slate-500 uppercase tracking-wider text-right whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {historyData.map((item) => (
                    <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="px-3 md:px-6 py-4 md:py-5">

                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.type === 'upload' ? 'bg-red-500/10 text-red-500' :
                            item.type === 'auto_process' ? 'bg-orange-500/10 text-orange-500' :
                              'bg-blue-500/10 text-blue-500'
                            }`}>
                            {item.type === 'upload' ? <Youtube size={18} /> :
                              item.type === 'auto_process' ? <Zap size={18} /> :
                                <Download size={18} />}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-white capitalize">{item.type.replace('_', ' ')}</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest">{item.format || 'original'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="max-w-[200px]">
                          <p className="text-sm text-white font-medium truncate mb-0.5">{item.title || item.videoTitle}</p>
                          {item.start !== undefined && (
                            <p className="text-xs text-slate-500 flex items-center gap-1">
                              <Clock size={12} /> {item.start}s - {item.end}s
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <p className="text-sm text-slate-400">{new Date(item.timestamp).toLocaleTimeString()}</p>
                        <p className="text-xs text-slate-500">{new Date(item.timestamp).toLocaleDateString()}</p>
                      </td>
                      <td className="px-6 py-5">
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold ${item.status === 'success' || item.status === 'detected' ? 'bg-green-500/10 text-green-400' :
                          item.status === 'pending' ? 'bg-orange-500/10 text-orange-400' :
                            'bg-red-500/10 text-red-400'
                          }`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${item.status === 'success' || item.status === 'detected' ? 'bg-green-400' :
                            item.status === 'pending' ? 'bg-orange-400' :
                              'bg-red-400'
                            }`} />
                          {item.status.toUpperCase()}
                        </div>
                      </td>
                      <td className="px-6 py-5 text-right">
                        {item.videoId ? (
                          <a
                            href={`https://youtube.com/shorts/${item.videoId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white p-2 rounded-lg transition-all inline-flex items-center gap-2 text-xs font-bold"
                          >
                            <ExternalLink size={14} />
                            View on YT
                          </a>
                        ) : item.type === 'auto_process' ? (
                          <Zap size={16} className="text-orange-500 inline mr-2 animate-pulse" />
                        ) : (
                          <span className="text-slate-600 italic text-xs">No link available</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {historyData.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center text-slate-500 italic">
                        Belum ada aktivitas yang tercatat.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      <footer className="mt-32 py-12 border-t border-white/5 bg-black/20">
        <div className="container mx-auto px-4 text-center">
          <p className="text-slate-500 text-sm font-medium mb-2">Designed with passion for content creators.</p>
          <p className="text-slate-600 text-xs">© 2026 ViralClip AI. Powering the next generation of social media.</p>
        </div>
      </footer>

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        authedFetch={authedFetch}
        showToast={showToast}
      />
    </div>
  );
}

function ClipCard({ clip, index, originalUrl, quality, useSubtitles, captionStyle, videoMode, isYoutubeConnected, onActionSuccess, authedFetch, showToast }: {
  clip: ClipMetadata;
  index: number;
  originalUrl: string;
  quality: string;
  useSubtitles: boolean;
  captionStyle: 'normal' | 'tiktok';
  videoMode: 'reframe' | 'center' | 'split';
  isYoutubeConnected: boolean;
  onActionSuccess: () => void | Promise<any>;
  authedFetch: any;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {

  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isThumbLoading, setIsThumbLoading] = useState(false);
  const ytId = getYouTubeId(originalUrl);

  const handleGenerateThumbnail = async () => {
    setIsThumbLoading(true);
    try {
      // For images/thumbnails we might need to handle token carefully or just proxy via authFetch
      const frameRes = await authedFetch(`/api/thumbnail/extract?url=${encodeURIComponent(originalUrl)}&time=${clip.startTimeSeconds + 1}`);
      if (!frameRes) return;
      const blob = await frameRes.blob();
      const frameUrl = URL.createObjectURL(blob);

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = frameUrl;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = 1080;
      canvas.height = 1920;

      // Draw original frame
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Add dark overlay at top/bottom for readability
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, 'rgba(0,0,0,0.6)');
      grad.addColorStop(0.2, 'rgba(0,0,0,0)');
      grad.addColorStop(0.8, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Add Viral Hook Text
      const text = clip.hook.toUpperCase();
      ctx.font = 'bold 100px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Text Shadow/Stroke
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 15;
      ctx.strokeText(text, canvas.width / 2, canvas.height * 0.2);

      // Actual Text
      ctx.fillStyle = '#fde047'; // Bright Yellow
      ctx.fillText(text, canvas.width / 2, canvas.height * 0.2);

      setThumbnailUrl(canvas.toDataURL('image/jpeg', 0.9));
      showToast("Thumbnail berhasil dibuat!", "success");
    } catch (e) {
      console.error("Thumbnail error:", e);
      showToast("Gagal membuat thumbnail. Pastikan link video valid.", "error");
    } finally {
      setIsThumbLoading(false);
    }
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await authedFetch(`/api/download-clip?url=${encodeURIComponent(originalUrl)}&start=${clip.startTimeSeconds}&end=${clip.endTimeSeconds}&format=${clip.aspectRatio}&quality=${quality}&useSubtitles=${useSubtitles}&captionStyle=${captionStyle}&videoMode=${videoMode}`);

      if (!response) return;

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Gagal mendownload");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `viral_clip_${clip.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast("Video berhasil didownload!", "success");
      onActionSuccess();
    } catch (e: any) {
      console.error("Download error:", e);
      showToast("Gagal mendownload video.", "error");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleYoutubeUpload = async () => {
    if (!isYoutubeConnected) {
      showToast("Silakan hubungkan akun YouTube Anda terlebih dahulu di bagian atas.", "error");
      return;
    }

    setIsUploading(true);
    try {
      const response = await authedFetch('/api/upload/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: originalUrl,
          start: clip.startTimeSeconds,
          end: clip.endTimeSeconds,
          title: clip.title,
          description: clip.description,
          tags: clip.tags,
          format: clip.aspectRatio,
          useSubtitles,
          captionStyle,
          videoMode
        })

      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Gagal mengupload");
      }

      const result = await response.json();
      showToast(`Berhasil! Video diupload ke YouTube Shorts. (ID: ${result.videoId})`, "success");
      onActionSuccess();
    } catch (e: any) {
      console.error("Upload error:", e);
      showToast(`Gagal upload: ${e.message}`, "error");
    } finally {
      setIsUploading(false);
    }
  };

  const handlePost = (platform: string) => {
    showToast(`Mengarahkan ke OAuth untuk ${platform}...`, "info");
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="bg-white/5 border border-white/10 rounded-2xl p-1.5 backdrop-blur-md hover:ring-1 hover:ring-purple-500/50 transition-all flex flex-col group relative"
    >
      <div className={`${clip.aspectRatio === 'landscape' ? 'aspect-video' : 'aspect-[9/16] max-h-[350px]'} bg-slate-800 rounded-xl mb-3 relative overflow-hidden flex-shrink-0 flex items-center justify-center p-0.5`}>
        {ytId ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${ytId}?start=${clip.startTimeSeconds}&end=${clip.endTimeSeconds}&rel=0`}
            className="w-full h-full rounded-lg"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          ></iframe>
        ) : (
          <>
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 to-blue-500/20 mix-blend-overlay rounded-lg" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-full flex items-center justify-center border border-white/40 group-hover:scale-110 transition-transform">
                <PlaySquare className="w-6 h-6 text-white ml-1" />
              </div>
            </div>
            <div className="absolute bottom-3 left-3 text-white font-mono text-xs tracking-wide flex items-center gap-1.5 bg-black/60 px-2.5 py-1 rounded-lg backdrop-blur-md">
              <Clock className="w-3.5 h-3.5" /> {clip.timestamps}
            </div>
          </>
        )}

        <div className={`absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded text-white shadow-lg flex items-center gap-1
          ${clip.viralScore > 85 ? 'bg-green-500 shadow-green-500/30' : 'bg-blue-500 shadow-blue-500/30'}`}>
          <TrendingUp className="w-3 h-3" />
          {clip.viralScore}% SCORE
        </div>
      </div>

      <div className="px-3 pb-3 flex flex-col flex-1">
        <h4 className="text-lg font-bold mb-1 p-1 text-white leading-tight truncate">
          {clip.title}
        </h4>

        <div className="mb-4 space-y-2 p-1">
          <div className="bg-slate-950/50 border border-white/10 text-slate-300 p-3 rounded-xl text-sm leading-relaxed">
            <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider block mb-1">AI Hook</span>
            &quot;{clip.hook}&quot;
          </div>
          <p className="text-slate-400 text-sm leading-relaxed line-clamp-2">
            {clip.description}
          </p>
          {clip.viralAnalysis && (
            <div className="bg-purple-500/10 border border-purple-500/20 text-purple-200 p-3 rounded-xl text-xs leading-relaxed">
              <span className="text-purple-400 font-bold uppercase text-[10px] tracking-wider block mb-1">Viral Analysis</span>
              {clip.viralAnalysis.split('\n').map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-6 mt-auto px-1">
          {clip.tags.map(tag => (
            <span key={tag} className="inline-flex items-center px-2 py-1 bg-purple-500/10 border border-purple-500/20 rounded text-[11px] text-purple-300 font-medium">
              <Hash className="w-3 h-3 opacity-50 mr-0.5" />
              {tag.replace('#', '')}
            </span>
          ))}
        </div>

        <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2 px-1">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); handleDownload(); }}
            disabled={isDownloading}
            className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:opacity-70 text-white py-3 rounded-xl text-sm font-bold shadow-lg shadow-purple-600/20 transition-all flex items-center justify-center gap-2"
          >
            {isDownloading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {isDownloading ? 'Downloading...' : 'Download'}
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleGenerateThumbnail}
              disabled={isThumbLoading}
              className="w-11 h-full min-h-[44px] bg-yellow-500 hover:bg-yellow-400 text-slate-900 rounded-xl flex items-center justify-center transition-colors shadow-lg shadow-yellow-500/20"
              title="Generate Viral Thumbnail"
            >
              {isThumbLoading ? <div className="w-4 h-4 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin" /> : <Sparkles className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={async (e) => {
                e.preventDefault();
                await handleYoutubeUpload();
              }}
              disabled={isUploading}
              className="w-11 h-full min-h-[44px] bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded-xl flex items-center justify-center transition-colors shadow-lg shadow-red-600/20"
              title="Upload ke YouTube Shorts"
            >
              <Youtube className="w-5 h-5" />
            </button>
          </div>
        </div>

        {thumbnailUrl && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-4 pt-4 border-t border-white/10"
          >
            <div className="flex items-center justify-between mb-3 text-xs font-bold text-yellow-500 uppercase tracking-widest">
              <span>Viral Thumbnail Generated</span>
              <button
                onClick={() => setThumbnailUrl(null)}
                className="text-slate-500 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
            <div className="relative aspect-[9/16] rounded-xl overflow-hidden border border-white/20 mb-3">
              <img src={thumbnailUrl} className="w-full h-full object-cover" alt="Thumbnail Preview" />
              <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                <button
                  onClick={() => {
                    const link = document.createElement('a');
                    link.download = `thumbnail-${clip.title}.jpg`;
                    link.href = thumbnailUrl;
                    link.click();
                  }}
                  className="w-full py-2 bg-yellow-500 text-slate-900 rounded-lg text-xs font-bold flex items-center justify-center gap-2"
                >
                  <Download size={14} /> Download Thumbnail
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

