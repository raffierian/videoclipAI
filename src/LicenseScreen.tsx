import React, { useState } from 'react';
import { Key, ShieldCheck, Lock, Sparkles, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LicenseScreenProps {
  onSuccess: () => void;
}

export function LicenseScreen({ onSuccess }: LicenseScreenProps) {
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;

    setLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: key.trim() })
      });
      const data = await res.json();
      
      if (data.success) {
        onSuccess();
      } else {
        setError(data.error || 'Aktivasi gagal. Lisensi tidak valid.');
      }
    } catch (err: any) {
      setError(err.message || 'Koneksi ke server gagal.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center p-4 overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 40% 60%, rgba(168,85,247,0.1) 0%, #080b14 60%)' }}>

      <div className="orb-1" style={{ top: '-10%', left: '-10%', background: 'radial-gradient(circle, rgba(168,85,247,0.1), transparent 70%)' }} />
      <div className="orb-2" style={{ bottom: '-10%', right: '-10%', background: 'radial-gradient(circle, rgba(99,102,241,0.08), transparent 70%)' }} />
      <div className="absolute inset-0 grid-bg opacity-30" />

      <motion.div 
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className="relative z-10 w-full max-w-sm"
      >
        <div className="relative rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(10, 14, 32, 0.92)',
            border: '1px solid rgba(168, 85, 247, 0.2)',
            boxShadow: '0 32px 80px rgba(0,0,0,0.5), 0 0 80px rgba(168,85,247,0.08), inset 0 1px 0 rgba(255,255,255,0.05)'
          }}>
          
          <div className="absolute top-0 inset-x-0 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(168,85,247,0.6), transparent)' }} />

          <div className="p-8">
            {/* Header */}
            <motion.div className="flex flex-col items-center mb-8" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <div className="relative mb-5">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                    boxShadow: '0 8px 32px rgba(168,85,247,0.5)'
                  }}>
                  <ShieldCheck size={24} className="text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #7c3aed)' }}>
                  <Sparkles size={8} className="text-white" />
                </div>
              </div>
              <h1 className="text-2xl font-bold text-white mb-1.5 tracking-tight"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Aktivasi <span style={{ background: 'linear-gradient(135deg, #a78bfa, #e879f9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Lisensi</span>
              </h1>
              <p className="text-slate-400 text-xs text-center leading-relaxed max-w-[230px]">
                Masukkan License Key Anda untuk mengaktifkan ViralClip AI di perangkat ini.
              </p>
            </motion.div>

            {/* License Key Features */}
            <div className="mb-6 grid grid-cols-3 gap-2">
              {[
                { icon: '🔒', label: 'Aman' },
                { icon: '⚡', label: 'Seketika' },
                { icon: '♾️', label: 'Permanen' },
              ].map(item => (
                <div key={item.label} className="flex flex-col items-center py-2.5 rounded-xl text-center"
                  style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.1)' }}>
                  <span className="text-lg mb-0.5">{item.icon}</span>
                  <span className="text-[10px] font-semibold text-slate-500">{item.label}</span>
                </div>
              ))}
            </div>

            <form onSubmit={handleActivate} className="space-y-3.5">
              {/* Key input */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 flex items-center gap-1.5">
                  <Key size={11} className="text-purple-400" /> License Key
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={key}
                    onChange={(e) => setKey(e.target.value.toUpperCase())}
                    placeholder="LK-XXXXXXXXXXXXXXXX"
                    className="input-modern font-mono text-center tracking-widest"
                    style={{ borderColor: key ? 'rgba(168,85,247,0.35)' : undefined, letterSpacing: '0.08em' }}
                    required
                    id="license-key-input"
                  />
                </div>
              </div>

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-start gap-2.5 p-3 rounded-xl"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <Lock size={13} className="text-red-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-400 font-semibold leading-relaxed">{error}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={loading || !key.trim()}
                id="license-activate-btn"
                className="btn-primary w-full"
                style={{ 
                  padding: '13px 20px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                  boxShadow: '0 8px 25px rgba(168,85,247,0.3)'
                }}
              >
                {loading ? (
                  <div className="spinner" style={{ borderTopColor: '#d8b4fe' }} />
                ) : (
                  <>
                    <ShieldCheck size={14} />
                    Aktivasi Sekarang
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="px-8 pb-6 text-center" style={{ borderTop: '1px solid rgba(99,102,241,0.08)' }}>
            <p className="text-slate-500 text-xs pt-4">
              Belum punya lisensi?{' '}
              <a href="https://rhwebs.com" target="_blank" rel="noreferrer"
                className="text-purple-400 hover:text-purple-300 font-semibold inline-flex items-center gap-1 transition-colors">
                Beli di rhwebs.com <ExternalLink size={10} />
              </a>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
