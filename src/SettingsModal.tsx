import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, Save, Key } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  authedFetch: (url: string, options?: any) => Promise<Response | null>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function SettingsModal({ isOpen, onClose, authedFetch, showToast }: SettingsModalProps) {
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [youtubeClientId, setYoutubeClientId] = useState('');
  const [youtubeClientSecret, setYoutubeClientSecret] = useState('');
  const [fbPageAccessToken, setFbPageAccessToken] = useState('');
  const [fbPageId, setFbPageId] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const res = await authedFetch('/api/settings');
      if (res && res.ok) {
        const data = await res.json();
        setGeminiKey(data.gemini_key || '');
        setOpenaiKey(data.openai_key || '');
        setGroqKey(data.groq_key || '');
        setYoutubeClientId(data.youtube_client_id || '');
        setYoutubeClientSecret(data.youtube_client_secret || '');
        setFbPageAccessToken(data.fb_page_access_token || '');
        setFbPageId(data.fb_page_id || '');
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await authedFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gemini_key: geminiKey,
          openai_key: openaiKey,
          groq_key: groqKey,
          youtube_client_id: youtubeClientId,
          youtube_client_secret: youtubeClientSecret,
          fb_page_access_token: fbPageAccessToken,
          fb_page_id: fbPageId
        })
      });
      if (res && res.ok) {
        showToast('Pengaturan berhasil disimpan!', 'success');
        onClose();
      } else {
        throw new Error('Gagal menyimpan');
      }
    } catch (e: any) {
      showToast(e.message || 'Terjadi kesalahan saat menyimpan pengaturan.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="p-6 border-b border-slate-800 flex justify-between items-center shrink-0">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Key className="text-blue-400" />
            Pengaturan API
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          <form id="settings-form" onSubmit={handleSave} className="space-y-4">
            
            <div className="pb-2 mb-2 border-b border-slate-800">
              <h3 className="text-blue-400 font-bold mb-3 uppercase tracking-wider text-xs">AI Models</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Gemini API Key</label>
                  <input
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-3 rounded-xl outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">OpenAI API Key (Opsional)</label>
                  <input
                    type="password"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-3 rounded-xl outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Groq API Key (Opsional)</label>
                  <input
                    type="password"
                    value={groqKey}
                    onChange={(e) => setGroqKey(e.target.value)}
                    placeholder="gsk_..."
                    className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-3 rounded-xl outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>
            </div>

            <div className="pb-2">
              <h3 className="text-red-400 font-bold mb-3 uppercase tracking-wider text-xs">YouTube Data API v3 (Wajib)</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Client ID</label>
                  <input
                    type="text"
                    value={youtubeClientId}
                    onChange={(e) => setYoutubeClientId(e.target.value)}
                    placeholder="...apps.googleusercontent.com"
                    className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-3 rounded-xl outline-none focus:border-red-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Client Secret</label>
                  <input
                    type="password"
                    value={youtubeClientSecret}
                    onChange={(e) => setYoutubeClientSecret(e.target.value)}
                    placeholder="GOCSPX-..."
                    className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-3 rounded-xl outline-none focus:border-red-500 transition-colors"
                  />
                </div>
              </div>
            </div>

            <div className="pb-2">
              <h3 className="text-blue-500 font-bold mb-3 uppercase tracking-wider text-xs">Facebook Page Video API</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Page Access Token</label>
                  <input
                    type="password"
                    value={fbPageAccessToken}
                    onChange={(e) => setFbPageAccessToken(e.target.value)}
                    placeholder="EAAG..."
                    className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-3 rounded-xl outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Page ID</label>
                  <input
                    type="text"
                    value={fbPageId}
                    onChange={(e) => setFbPageId(e.target.value)}
                    placeholder="1000..."
                    className="w-full bg-slate-950 border border-slate-800 text-white px-4 py-3 rounded-xl outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>
            </div>
          </form>
        </div>

        <div className="p-6 border-t border-slate-800 shrink-0 bg-slate-900">
          <button
            form="settings-form"
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Save size={20} />
                Simpan Pengaturan
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
