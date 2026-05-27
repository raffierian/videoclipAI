import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, Lock, ArrowRight, Loader2, Sparkles, Zap, Eye, EyeOff, Shield } from 'lucide-react';

interface LoginProps {
  onLogin: (token: string, user: any) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin]             = useState(true);
  const [email, setEmail]                 = useState('');
  const [password, setPassword]           = useState('');
  const [showPassword, setShowPassword]   = useState(false);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [successMsg, setSuccessMsg]       = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    try {
      const res  = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan');

      if (isLogin) {
        onLogin(data.token, data.user);
      } else {
        setSuccessMsg('Akun berhasil dibuat! Silakan masuk.');
        setIsLogin(true);
        setPassword('');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 60% 30%, rgba(99,102,241,0.12) 0%, #080b14 60%)' }}>

      <div className="orb-1" />
      <div className="orb-2" />
      <div className="absolute inset-0 grid-bg" style={{ opacity: 0.35 }} />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="relative rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(9, 13, 28, 0.96)',
            border: '1px solid rgba(99,102,241,0.2)',
            boxShadow: '0 40px 90px rgba(0,0,0,0.55), 0 0 80px rgba(99,102,241,0.08), inset 0 1px 0 rgba(255,255,255,0.05)'
          }}>

          {/* Top glow */}
          <div className="absolute top-0 inset-x-0 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.65), transparent)' }} />

          <div style={{ padding: '36px 36px 28px' }}>
            {/* Logo */}
            <motion.div className="flex flex-col items-center mb-8"
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <div className="relative mb-5">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center logo-icon"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#7c3aed)', boxShadow: '0 10px 36px rgba(99,102,241,0.5), 0 0 0 1px rgba(99,102,241,0.3)' }}>
                  <Zap size={28} fill="currentColor" className="text-white" />
                </div>
                <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#7c3aed)', border: '2px solid #080b14' }}>
                  <Sparkles size={10} className="text-white" />
                </div>
              </div>
              <h1 className="font-bold text-white mb-2"
                style={{ fontSize: 26, fontFamily: "'Space Grotesk',sans-serif", letterSpacing: '-0.5px' }}>
                ViralClip <span className="gradient-text">AI</span>
              </h1>
              <p className="text-slate-400 text-center leading-relaxed" style={{ fontSize: 14, maxWidth: 260 }}>
                {isLogin
                  ? 'Masuk ke dasbor otomatisasi konten viral Anda'
                  : 'Buat akun untuk mulai membuat konten viral dengan AI'}
              </p>
            </motion.div>

            {/* Tab switcher */}
            <div className="flex mb-6 p-1 rounded-xl" style={{ background: 'rgba(6,9,22,0.85)', border: '1px solid rgba(99,102,241,0.1)' }}>
              {[{ label: 'Masuk', val: true }, { label: 'Daftar', val: false }].map(tab => (
                <button key={tab.label}
                  onClick={() => { setIsLogin(tab.val); setError(null); setSuccessMsg(null); }}
                  className="flex-1 py-2.5 rounded-lg transition-all duration-200 font-semibold"
                  style={{
                    fontSize: 14,
                    background: isLogin === tab.val ? 'linear-gradient(135deg,rgba(99,102,241,0.3),rgba(124,58,237,0.2))' : 'transparent',
                    color: isLogin === tab.val ? '#c7d2fe' : '#475569',
                    border: isLogin === tab.val ? '1px solid rgba(99,102,241,0.25)' : '1px solid transparent',
                  }}>
                  {tab.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email */}
              <div>
                <label className="text-label text-slate-500 block mb-2">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none" style={{ opacity: 0.6 }} />
                  <input type="email" required placeholder="nama@email.com" value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="input-modern" style={{ paddingLeft: 44, fontSize: 14.5 }}
                    id="login-email" />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="text-label text-slate-500 block mb-2">Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none" style={{ opacity: 0.6 }} />
                  <input type={showPassword ? 'text' : 'password'} required placeholder="••••••••"
                    value={password} onChange={e => setPassword(e.target.value)}
                    className="input-modern" style={{ paddingLeft: 44, paddingRight: 48, fontSize: 14.5 }}
                    id="login-password" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 transition-colors"
                    style={{ color: showPassword ? '#818cf8' : '#475569' }}>
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Messages */}
              <AnimatePresence mode="wait">
                {error && (
                  <motion.div key="err" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="flex items-center gap-2.5 p-3.5 rounded-xl"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                      <p className="text-red-400 font-semibold" style={{ fontSize: 13.5 }}>{error}</p>
                    </div>
                  </motion.div>
                )}
                {successMsg && (
                  <motion.div key="ok" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="flex items-center gap-2.5 p-3.5 rounded-xl"
                      style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                      <p className="text-emerald-400 font-semibold" style={{ fontSize: 13.5 }}>{successMsg}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Submit */}
              <button type="submit" disabled={loading} id="login-submit"
                className="btn-primary w-full mt-2"
                style={{ padding: '14px 20px', fontSize: 15, borderRadius: 13 }}>
                {loading ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <>
                    <Sparkles size={16} />
                    {isLogin ? 'Masuk ke Dashboard' : 'Buat Akun Gratis'}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Footer */}
          <div style={{ padding: '16px 36px 20px', borderTop: '1px solid rgba(99,102,241,0.08)' }}>
            <div className="flex items-center justify-center gap-3">
              <div className="flex items-center gap-1.5 text-slate-600" style={{ fontSize: 12 }}>
                <Shield size={11} className="text-indigo-600" />
                <span>Data aman & terenkripsi</span>
              </div>
              <div className="w-1 h-1 rounded-full bg-slate-700" />
              <p className="text-slate-600" style={{ fontSize: 12 }}>ViralClip AI © 2026</p>
              <div className="w-1 h-1 rounded-full bg-slate-700" />
              <p className="text-slate-600" style={{ fontSize: 12 }}>Powered by Gemini</p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
