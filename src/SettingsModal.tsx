import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Save, Key, Brain, Youtube, Facebook, Instagram, Cpu,
  FolderOpen, Eye, EyeOff, CheckCircle2, Zap, Sparkles,
  Globe, AlertCircle, Info, ChevronRight
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  authedFetch: (url: string, options?: any) => Promise<Response | null>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type SettingsSection = 'ai' | 'youtube' | 'facebook' | 'instagram' | 'tiktok' | 'advanced';

const sections: { id: SettingsSection; label: string; icon: React.ReactNode; color: string; desc: string }[] = [
  { id: 'ai',        label: 'AI Models',      icon: <Brain size={15} />,     color: '#818cf8', desc: 'Gemini, Groq, OpenAI' },
  { id: 'youtube',   label: 'YouTube',         icon: <Youtube size={15} />,   color: '#ef4444', desc: 'OAuth & Shorts upload' },
  { id: 'facebook',  label: 'Facebook',        icon: <Facebook size={15} />,  color: '#3b82f6', desc: 'Page video upload' },
  { id: 'instagram', label: 'Instagram',       icon: <Instagram size={15} />, color: '#ec4899', desc: 'Reels via Meta API' },
  { id: 'tiktok',    label: 'TikTok',          icon: <Cpu size={15} />,       color: '#14b8a6', desc: 'Direct Post API' },
  { id: 'advanced',  label: 'Advanced',        icon: <FolderOpen size={15} />, color: '#a855f7', desc: 'Split-screen & more' },
];

// ── Shared field components ────────────────────────────────────────────────
function PasswordField({ label, value, onChange, placeholder, helpText, focusColor = '#6366f1' }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; helpText?: string; focusColor?: string;
}) {
  const [show, setShow] = useState(false);
  const filled = value.length > 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="font-bold text-slate-400" style={{ fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>
        {filled && <span className="flex items-center gap-1 text-emerald-400 font-semibold" style={{ fontSize: 11.5 }}><CheckCircle2 size={11} />Tersimpan</span>}
      </div>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="input-modern font-mono pr-10"
          style={{ fontSize: 13.5 }}
        />
        <button type="button" onClick={() => setShow(!show)}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-colors"
          style={{ color: show ? focusColor : '#475569' }}>
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {helpText && <p className="text-slate-600 mt-1.5 leading-relaxed" style={{ fontSize: 12 }}>{helpText}</p>}
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, helpText }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; helpText?: string;
}) {
  return (
    <div>
      <label className="block font-bold text-slate-400 mb-2" style={{ fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="input-modern font-mono" style={{ fontSize: 13.5 }} />
      {helpText && <p className="text-slate-600 mt-1.5 leading-relaxed" style={{ fontSize: 12 }}>{helpText}</p>}
    </div>
  );
}

function InfoBox({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-3.5 rounded-xl" style={{
      background: `rgba(${hexToRgb(color)},0.07)`, border: `1px solid rgba(${hexToRgb(color)},0.15)`
    }}>
      <Info size={14} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <p className="text-slate-400 leading-relaxed" style={{ fontSize: 13 }}>{children}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
export function SettingsModal({ isOpen, onClose, authedFetch, showToast }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('ai');
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [youtubeClientId, setYoutubeClientId] = useState('');
  const [youtubeClientSecret, setYoutubeClientSecret] = useState('');
  const [fbPageAccessToken, setFbPageAccessToken] = useState('');
  const [fbPageId, setFbPageId] = useState('');
  const [igBusinessAccountId, setIgBusinessAccountId] = useState('');
  const [tiktokAccessToken, setTiktokAccessToken] = useState('');
  const [satisfyingVideoPath, setSatisfyingVideoPath] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (isOpen) { loadSettings(); setActiveSection('ai'); } }, [isOpen]);

  const loadSettings = async () => {
    try {
      const res = await authedFetch('/api/settings');
      if (res?.ok) {
        const data = await res.json();
        setGeminiKey(data.gemini_key || '');
        setOpenaiKey(data.openai_key || '');
        setGroqKey(data.groq_key || '');
        setYoutubeClientId(data.youtube_client_id || '');
        setYoutubeClientSecret(data.youtube_client_secret || '');
        setFbPageAccessToken(data.fb_page_access_token || '');
        setFbPageId(data.fb_page_id || '');
        setIgBusinessAccountId(data.ig_business_account_id || '');
        setTiktokAccessToken(data.tiktok_access_token || '');
        setSatisfyingVideoPath(data.satisfying_video_path || '');
      }
    } catch (e) { console.error('Failed to load settings:', e); }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await authedFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gemini_key: geminiKey, openai_key: openaiKey, groq_key: groqKey,
          youtube_client_id: youtubeClientId, youtube_client_secret: youtubeClientSecret,
          fb_page_access_token: fbPageAccessToken, fb_page_id: fbPageId,
          ig_business_account_id: igBusinessAccountId, tiktok_access_token: tiktokAccessToken,
          satisfying_video_path: satisfyingVideoPath
        })
      });
      if (res?.ok) {
        showToast('Pengaturan berhasil disimpan!', 'success');
        setSaved(true);
        setTimeout(() => { setSaved(false); onClose(); }, 1200);
      } else throw new Error('Gagal menyimpan');
    } catch (e: any) {
      showToast(e.message || 'Terjadi kesalahan saat menyimpan.', 'error');
    } finally { setIsLoading(false); }
  };

  if (!isOpen) return null;

  const currentSection = sections.find(s => s.id === activeSection);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0"
          style={{ background: 'rgba(4,7,18,0.88)', backdropFilter: 'blur(14px)' }}
          onClick={onClose} />

        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 20 }}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          className="relative w-full flex overflow-hidden rounded-2xl"
          style={{
            background: 'rgba(8,11,28,0.98)',
            border: '1px solid rgba(99,102,241,0.2)',
            boxShadow: '0 40px 100px rgba(0,0,0,0.65), 0 0 80px rgba(99,102,241,0.08)',
            maxHeight: '90vh',
            maxWidth: 680
          }}>

          {/* Top glow */}
          <div className="absolute top-0 inset-x-0 h-px z-10"
            style={{ background: 'linear-gradient(90deg,transparent,rgba(99,102,241,0.65),transparent)' }} />

          {/* ── Left sidebar ── */}
          <div className="flex-shrink-0 flex flex-col"
            style={{ width: 196, borderRight: '1px solid rgba(99,102,241,0.1)', background: 'rgba(5,8,20,0.9)' }}>

            {/* Logo */}
            <div className="p-5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(99,102,241,0.08)' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#7c3aed)', boxShadow: '0 4px 16px rgba(99,102,241,0.4)' }}>
                  <Key size={15} className="text-white" />
                </div>
                <div>
                  <p className="font-bold text-white" style={{ fontSize: 13.5 }}>API Settings</p>
                  <p className="text-slate-600 font-semibold" style={{ fontSize: 11 }}>Konfigurasi</p>
                </div>
              </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {sections.map(s => (
                <button key={s.id} onClick={() => setActiveSection(s.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all"
                  style={{
                    background: activeSection === s.id ? 'rgba(99,102,241,0.14)' : 'transparent',
                    border: activeSection === s.id ? '1px solid rgba(99,102,241,0.22)' : '1px solid transparent',
                  }}>
                  <span style={{ color: activeSection === s.id ? s.color : '#374151', flexShrink: 0 }}>{s.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold truncate" style={{ fontSize: 13.5, color: activeSection === s.id ? '#c7d2fe' : '#64748b' }}>{s.label}</p>
                    <p className="truncate" style={{ fontSize: 11, color: activeSection === s.id ? '#6366f1' : '#2d3a52' }}>{s.desc}</p>
                  </div>
                  {activeSection === s.id && <ChevronRight size={13} className="text-indigo-500 flex-shrink-0" />}
                </button>
              ))}
            </nav>

            {/* Hint */}
            <div className="p-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(99,102,241,0.08)' }}>
              <div className="p-3 rounded-xl" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.13)' }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <Sparkles size={11} className="text-indigo-400" />
                  <p className="font-bold text-indigo-400" style={{ fontSize: 11 }}>Pro Tip</p>
                </div>
                <p className="text-slate-600 leading-relaxed" style={{ fontSize: 11 }}>
                  Groq (Free) adalah fallback terbaik — unlimited dengan model Llama 3.3 70B.
                </p>
              </div>
            </div>
          </div>

          {/* ── Right content ── */}
          <div className="flex-1 flex flex-col min-w-0" style={{ minHeight: 0 }}>
            {/* Header */}
            <div className="px-7 py-5 flex-shrink-0 flex items-center justify-between"
              style={{ borderBottom: '1px solid rgba(99,102,241,0.1)' }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `rgba(${hexToRgb(currentSection?.color || '#818cf8')},0.15)`, color: currentSection?.color }}>
                  {currentSection?.icon}
                </div>
                <div>
                  <h2 className="font-bold text-white" style={{ fontSize: 15.5 }}>{currentSection?.label}</h2>
                  <p className="text-slate-500 font-medium" style={{ fontSize: 12 }}>{currentSection?.desc}</p>
                </div>
              </div>
              <button onClick={onClose}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all"
                style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.14)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.08)')}>
                <X size={15} className="text-slate-400" />
              </button>
            </div>

            {/* Scrollable form area */}
            <div className="flex-1 overflow-y-auto p-7">
              <form id="settings-form" onSubmit={handleSave}>
                <AnimatePresence mode="wait">
                  <motion.div key={activeSection}
                    initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.15 }}
                    className="space-y-5">

                    {activeSection === 'ai' && (
                      <>
                        <InfoBox color="#818cf8">
                          AI menggunakan <strong className="text-slate-300">chain fallback</strong>: Groq → Gemini → OpenAI. Setidaknya isi satu key.
                        </InfoBox>
                        <PasswordField label="Gemini API Key (Primary)" value={geminiKey} onChange={setGeminiKey}
                          placeholder="AIzaSy..." helpText="Gemini 1.5 Flash — paling akurat. Dapatkan di Google AI Studio." />
                        <PasswordField label="Groq API Key (Fallback - Rekomendasi)" value={groqKey} onChange={setGroqKey}
                          placeholder="gsk_..." helpText="Llama 3.3 70B via Groq — tercepat & gratis. Daftar di console.groq.com." />
                        <PasswordField label="OpenAI API Key (Opsional)" value={openaiKey} onChange={setOpenaiKey}
                          placeholder="sk-..." helpText="GPT-4o Mini — fallback terakhir. Berbayar per token." />
                      </>
                    )}

                    {activeSection === 'youtube' && (
                      <>
                        <InfoBox color="#ef4444">
                          Buat project di <strong className="text-slate-300">Google Cloud Console</strong>, aktifkan YouTube Data API v3, lalu buat OAuth 2.0 Credentials (Desktop App).
                        </InfoBox>
                        <TextField label="Client ID" value={youtubeClientId} onChange={setYoutubeClientId}
                          placeholder="...apps.googleusercontent.com"
                          helpText="Dari Google Cloud Console → Credentials → OAuth 2.0 Client IDs" />
                        <PasswordField label="Client Secret" value={youtubeClientSecret} onChange={setYoutubeClientSecret}
                          placeholder="GOCSPX-..." focusColor="#ef4444"
                          helpText="Simpan rahasia ini — jangan dibagikan kepada siapapun." />
                        <div className="p-3.5 rounded-xl" style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.15)' }}>
                          <p className="font-bold text-red-400 mb-1.5" style={{ fontSize: 12 }}>📝 Redirect URI yang harus ditambahkan:</p>
                          <p className="font-mono text-slate-400" style={{ fontSize: 12.5 }}>http://localhost:3000/api/auth/youtube/callback</p>
                        </div>
                      </>
                    )}

                    {activeSection === 'facebook' && (
                      <>
                        <InfoBox color="#3b82f6">
                          Buat Facebook App di <strong className="text-slate-300">developers.facebook.com</strong>, tambahkan produk "Facebook Login" dan "Pages API".
                        </InfoBox>
                        <PasswordField label="Page Access Token" value={fbPageAccessToken} onChange={setFbPageAccessToken}
                          placeholder="EAAG..." focusColor="#3b82f6"
                          helpText="Token permanen (Never Expires) dari Facebook Graph API Explorer dengan scope: pages_manage_posts, pages_read_engagement" />
                        <TextField label="Page ID" value={fbPageId} onChange={setFbPageId}
                          placeholder="1000xxxxxxxx"
                          helpText="Buka Facebook Page → About → Page ID (angka panjang)" />
                      </>
                    )}

                    {activeSection === 'instagram' && (
                      <>
                        <InfoBox color="#ec4899">
                          Instagram menggunakan <strong className="text-slate-300">Meta Business API</strong>. Pastikan Instagram terhubung ke Facebook Page di Business Suite.
                        </InfoBox>
                        <TextField label="Instagram Business Account ID" value={igBusinessAccountId} onChange={setIgBusinessAccountId}
                          placeholder="1784xxxxxxxxx"
                          helpText="Dari Graph API: GET /{page-id}?fields=instagram_business_account" />
                        <div className="p-3.5 rounded-xl" style={{ background: 'rgba(236,72,153,0.07)', border: '1px solid rgba(236,72,153,0.15)' }}>
                          <p className="font-bold text-pink-400 mb-1.5" style={{ fontSize: 12 }}>💡 Catatan Penting:</p>
                          <p className="text-slate-500 leading-relaxed" style={{ fontSize: 13 }}>
                            Instagram menggunakan <strong className="text-slate-400">Facebook Page Access Token</strong> yang sama (dari tab Facebook di atas). Pastikan scope token mencakup: <span className="font-mono text-pink-300">instagram_content_publish, instagram_manage_insights</span>
                          </p>
                        </div>
                      </>
                    )}

                    {activeSection === 'tiktok' && (
                      <>
                        <InfoBox color="#14b8a6">
                          Daftarkan aplikasi di <strong className="text-slate-300">developers.tiktok.com</strong>, aktifkan "Direct Post API", dan dapatkan access token.
                        </InfoBox>
                        <PasswordField label="TikTok Access Token" value={tiktokAccessToken} onChange={setTiktokAccessToken}
                          placeholder="act.example..." focusColor="#14b8a6"
                          helpText="Access token dari TikTok Developer Console. Pastikan scope: video.upload, video.publish" />
                      </>
                    )}

                    {activeSection === 'advanced' && (
                      <>
                        <InfoBox color="#a855f7">
                          Konfigurasi untuk mode <strong className="text-slate-300">Split-Screen</strong> — video gameplay/satisfying akan ditampilkan di bagian bawah layar.
                        </InfoBox>
                        <div>
                          <label className="flex items-center gap-2 font-bold text-slate-400 mb-2" style={{ fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            <FolderOpen size={13} className="text-purple-400" />
                            Path Video Game / Satisfying (MP4 Lokal)
                          </label>
                          <input type="text" value={satisfyingVideoPath}
                            onChange={e => setSatisfyingVideoPath(e.target.value)}
                            placeholder="C:\videos\gameplay.mp4"
                            className="input-modern font-mono"
                            style={{ fontSize: 13.5 }} />
                          <p className="text-slate-600 mt-2 leading-relaxed" style={{ fontSize: 12.5 }}>
                            Video ini diputar loop di bagian bawah saat mode Split-Screen aktif. Format yang didukung: MP4, MOV, AVI. Pastikan resolusi minimal 1080x960.
                          </p>
                        </div>
                        <div className="p-3.5 rounded-xl" style={{ background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.15)' }}>
                          <p className="font-bold text-purple-400 mb-2" style={{ fontSize: 12 }}>🎮 Tips Pilih Video Satisfying:</p>
                          <ul className="space-y-1.5">
                            {['Gameplay Subway Surfers / Temple Run (vertical)', 'Video memasak sederhana (landscape dipotong center)', 'Satisfying slime / sand cutting', 'Minecraft parkour (vertical)'].map((t, i) => (
                              <li key={i} className="flex gap-2 text-slate-500" style={{ fontSize: 13 }}>
                                <span className="text-purple-600 flex-shrink-0">•</span>{t}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </form>
            </div>

            {/* Footer save button */}
            <div className="px-7 py-5 flex-shrink-0" style={{ borderTop: '1px solid rgba(99,102,241,0.1)' }}>
              <button form="settings-form" type="submit" disabled={isLoading} id="settings-save-btn"
                className="btn-primary w-full"
                style={{ padding: '13px', fontSize: 14.5, borderRadius: 13 }}>
                {isLoading ? (
                  <div className="spinner" />
                ) : saved ? (
                  <><CheckCircle2 size={16} className="text-green-400" /><span className="text-green-300">Tersimpan!</span></>
                ) : (
                  <><Save size={15} />Simpan Semua Pengaturan</>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '99,102,241';
  return `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}`;
}
