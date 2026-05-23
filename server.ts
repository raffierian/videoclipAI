import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import youtubedl from "youtube-dl-exec";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import contentDisposition from "content-disposition";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import db from "./lib/db";
import { register, login, authMiddleware } from "./lib/auth";

dotenv.config();

const __dirname = path.resolve();

function getOAuthClient(userId: number) {
  const settings = db.prepare('SELECT youtube_client_id, youtube_client_secret FROM settings WHERE user_id = ?').get(userId) as any;
  if (!settings || !settings.youtube_client_id || !settings.youtube_client_secret) {
    throw new Error("YouTube Client ID dan Secret belum diatur. Silakan isi di menu Pengaturan API.");
  }
  return new OAuth2Client(
    settings.youtube_client_id,
    settings.youtube_client_secret,
    "http://localhost:3000/api/auth/youtube/callback"
  );
}

// Helper for history
function saveToHistory(userId: number, entry: any) {
  try {
    const stmt = db.prepare('INSERT INTO history (id, user_id, type, title, url, status, details) VALUES (?, ?, ?, ?, ?, ?, ?)');
    stmt.run(
      Date.now().toString() + Math.random().toString(36).substring(7),
      userId,
      entry.type,
      entry.title || null,
      entry.url || null,
      entry.status || 'success',
      JSON.stringify(entry.details || {})
    );
  } catch (e) {
    console.error("Failed to save to history:", e);
  }
}

// Helper for Subtitles
function shiftSubtitles(content: string, offsetSeconds: number) {
  return content.replace(/(\d{2}):(\d{2}):(\d{2})([.,])(\d{3})/g, (match, h, m, s, sep, ms) => {
    let totalMs = parseInt(h) * 3600000 + parseInt(m) * 60000 + parseInt(s) * 1000 + parseInt(ms);
    totalMs -= offsetSeconds * 1000;
    if (totalMs < 0) totalMs = 0;
    const newH = Math.floor(totalMs / 3600000).toString().padStart(2, '0');
    const newM = Math.floor((totalMs % 3600000) / 60000).toString().padStart(2, '0');
    const newS = Math.floor((totalMs % 60000) / 1000).toString().padStart(2, '0');
    const newMs = (totalMs % 1000).toString().padStart(3, '0');
    return `${newH}:${newM}:${newS}${sep}${newMs}`;
  });
}

async function prepareSubtitles(info: any, offsetSeconds: number, captionStyle: 'normal' | 'tiktok' = 'normal') {
  let subUrl = null;
  let ext = 'srt';
  const langs = ['id', 'en'];
  for (const source of [info.subtitles, info.automatic_captions]) {
    if (!source) continue;
    for (const lang of langs) {
      if (source[lang]) {
        const track = source[lang].find((s: any) => s.ext === 'srt' || s.ext === 'vtt');
        if (track) { subUrl = track.url; ext = track.ext; break; }
      }
    }
    if (subUrl) break;
  }

  if (!subUrl) return null;
  try {
    const subRes = await fetch(subUrl);
    let subText = await subRes.text();
    subText = shiftSubtitles(subText, offsetSeconds);

    // Apply TikTok-style word-by-word captions if requested
    if (captionStyle === 'tiktok' && (ext === 'srt' || ext === 'vtt')) {
      subText = generateShortlineSRT(subText);
      ext = 'srt'; // always output as SRT after transform
    }

    const rawPath = path.join(os.tmpdir(), `temp_sub_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`);
    fs.writeFileSync(rawPath, subText);

    // Escape path for windows FFmpeg subtitle filter: C:\path -> C\\:/path
    const ffmpegPath = rawPath.replace(/\\/g, '/').replace(':', '\\:');
    return { rawPath, ffmpegPath };
  } catch (e) {
    return null;
  }
}


// Returns FFmpeg force_style string for subtitle rendering
function getSubtitleStyle(captionStyle: 'normal' | 'tiktok'): string {
  if (captionStyle === 'tiktok') {
    // TikTok style: kecil, hanya di bawah, tidak mengganggu
    return [
      'FontSize=22', 'FontName=Arial',  // Ukuran kecil
      'PrimaryColour=&H00FFFFFF', 'OutlineColour=&H00000000',
      'BackColour=&H80000000',  // Background semi-transparan
      'Bold=1', 'BorderStyle=1', 'Outline=2', 'Shadow=1',
      'Alignment=2',  // Bottom center
      'MarginV=40', 'MarginL=50', 'MarginR=50',  // Margin dari bawah
    ].join(',');
  }
  // Normal style: sangat kecil dan minimalis
  return [
    'FontSize=20', 'FontName=Arial',  // Ukuran sangat kecil
    'PrimaryColour=&H00FFFFFF', 'OutlineColour=&H00000000',
    'BackColour=&H80000000',
    'Bold=0', 'BorderStyle=1', 'Outline=2', 'Shadow=1',
    'Alignment=2', 'MarginV=30', 'MarginL=40', 'MarginR=40',  // Sangat dekat dengan bawah
  ].join(',');
}

// === FEATURE: Face Tracking Reframing ===
// Calls face_reframe.py in 'track' mode — smooth per-frame face-following crop
import { spawn } from 'child_process';

const venvPy = (() => {
  const p = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
  return fs.existsSync(p) ? p : 'python';
})();

function spawnPython(args: string[], timeoutMs = 120000): Promise<string | null> {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'scripts', args[0]);
    if (!fs.existsSync(scriptPath)) { resolve(null); return; }
    let stdout = '';
    const proc = spawn(venvPy, [scriptPath, ...args.slice(1)]);
    proc.stdout.on('data', (d: Buffer) => stdout += d.toString());
    proc.on('close', () => {
      try { resolve(stdout.trim()); } catch { resolve(null); }
    });
    proc.on('error', () => resolve(null));
    setTimeout(() => { try { proc.kill(); } catch { } resolve(null); }, timeoutMs);
  });
}

// Run new timeline-based face tracker:
// Python detects face positions → writes an FFmpeg sendcmd file
// FFmpeg then applies a smooth dynamic crop — audio is preserved!
async function runFaceTimeline(inputPath: string): Promise<{ cmdsPath: string; crop_w: number; crop_h: number } | null> {
  const cmdsPath = path.join(os.tmpdir(), `face_cmds_${Date.now()}.txt`);
  const raw = await spawnPython(['face_detect_timeline.py', inputPath, cmdsPath], 90000);
  if (!raw) return null;
  try {
    const result = JSON.parse(raw);
    if (result.status === 'ok' && fs.existsSync(cmdsPath) && result.detected > 0) {
      return { cmdsPath, crop_w: result.crop_w, crop_h: result.crop_h };
    }
  } catch { }
  if (fs.existsSync(cmdsPath)) try { fs.unlinkSync(cmdsPath); } catch { }
  return null;
}

// Legacy detect-only (kept as fallback)
async function runFaceDetection(videoPath: string): Promise<{ crop_x: number; crop_w: number; crop_h: number } | null> {
  const raw = await spawnPython(['face_reframe.py', 'detect', videoPath], 45000);
  if (!raw) return null;
  try {
    const result = JSON.parse(raw);
    if (result.status === 'ok') return { crop_x: result.crop_x, crop_w: result.crop_w, crop_h: result.crop_h };
  } catch { }
  return null;
}

// Generate clickbait thumbnail from video
async function generateThumbnailPy(videoPath: string, title: string, hook: string): Promise<string | null> {
  const thumbPath = path.join(os.tmpdir(), `thumb_${Date.now()}.jpg`);
  const raw = await spawnPython(['thumbnail_gen.py', videoPath, thumbPath, title, hook], 60000);
  if (!raw) return null;
  try {
    const result = JSON.parse(raw);
    if (result.status === 'ok' && fs.existsSync(thumbPath)) return thumbPath;
  } catch { }
  return null;
}



// === FEATURE: Word-Level TikTok-style SRT Generation ===
// Converts a standard SRT/VTT into shorter lines (≤4 words) for high-impact display
function generateShortlineSRT(rawSRT: string): string {
  const lines = rawSRT.split('\n');
  let result = '';
  let idx = 1;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // SRT index number
    if (/^\d+$/.test(line)) {
      i++;
      const timeLine = (lines[i] || '').trim();
      i++;
      // Collect text lines until blank
      let textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim());
        i++;
      }
      i++; // skip blank

      const text = textLines.join(' ').replace(/<[^>]+>/g, ''); // strip html tags
      if (!text || !timeLine.includes('-->')) continue;

      const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());

      // Parse time to milliseconds
      const parseMs = (t: string) => {
        const parts = t.replace(',', '.').split(':');
        if (parts.length === 3) {
          return (parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])) * 1000;
        }
        return 0;
      };
      const toSrtTime = (ms: number) => {
        const h = Math.floor(ms / 3600000).toString().padStart(2, '0');
        const m = Math.floor((ms % 3600000) / 60000).toString().padStart(2, '0');
        const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
        const ms2 = (ms % 1000).toString().padStart(3, '0');
        return `${h}:${m}:${s},${ms2}`;
      };

      const startMs = parseMs(startStr);
      const endMs = parseMs(endStr);
      const words = text.split(' ').filter(w => w.length > 0);
      const chunkSize = 3; // words per subtitle - lebih banyak kata per baris (dari 2 ke 3)
      const durationMs = endMs - startMs;
      const perChunk = Math.max(400, durationMs / Math.ceil(words.length / chunkSize));  // Durasi lebih lama per chunk

      for (let w = 0; w < words.length; w += chunkSize) {
        const chunk = words.slice(w, w + chunkSize).join(' ');
        const chunkStart = startMs + (w / chunkSize) * perChunk;
        const chunkEnd = Math.min(chunkStart + perChunk, endMs);
        // Gunakan title case untuk lebih proporsional (tidak semua uppercase)
        const formattedChunk = chunk.split(' ').map(word =>
          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
        result += `${idx}\n${toSrtTime(chunkStart)} --> ${toSrtTime(chunkEnd)}\n${formattedChunk}\n\n`;
        idx++;
      }
    } else {
      i++;
    }
  }
  return result;
}



async function startServer() {
  const app = express();
  const PORT = 3000;

  ffmpeg.setFfmpegPath(ffmpegStatic as string);

  let watcherStatus = {
    isChecking: false,
    lastChecked: null as string | null,
    lastAction: "Idle",
    logs: [] as string[]
  };

  const addWatcherLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    watcherStatus.logs.unshift(`[${time}] ${msg}`);
    watcherStatus.logs = watcherStatus.logs.slice(0, 10);
    watcherStatus.lastAction = msg;
    console.log(`[Watcher] ${msg}`);
  };

  // === SERVER-SIDE GEMINI CLIP ANALYSIS ===
  const aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  async function analyzeClipsServer(videoUrl: string, videoTitle: string, transcript: string, count = 3, userId?: number) {
    const prompt = `
Anda adalah VIRAL VIDEO EDITOR PROFESIONAL kelas dunia yang bekerja di tim TikTok/YouTube Shorts.
Anda memiliki pengalaman 10 tahun memotong video panjang menjadi short-form viral content yang mendapatkan jutaan views.

VIDEO INFO:
- Title: "${videoTitle}"
- URL: ${videoUrl}

TRANSKRIP (dengan timestamp):
${transcript.substring(0, 15000)}

TUGAS: Temukan **${count} momen TERBAIK** dari transkrip di atas yang akan menjadi SHORT VIDEO VIRAL.

## ⚠️ KRITERIA WAJIB VIRAL (HARUS DIPENUHI SEMUA):

### 1. DURASI PADAT & OPTIMAL
- ✅ **10-15 detik** untuk konten looping (momen lucu, reaksi, reveal)
- ✅ **25-35 detik** untuk tutorial/tips (maksimal!)
- ❌ TOLAK klip > 40 detik (terlalu panjang, retention drop)
- ❌ BUANG semua jeda napas, "ehm", "jadi", transisi boring

### 2. HOOK 3 DETIK PERTAMA (PALING PENTING!)
Detik 1-3 HARUS langsung:
- ✅ Visual shocking/menarik (hasil akhir, reaksi kaget, aksi dramatis)
- ✅ Kalimat pancingan kuat: "Gak nyangka...", "Ternyata...", "Jangan coba ini..."
- ✅ Pertanyaan yang bikin penasaran: "Kenapa bisa begini?"
- ❌ JANGAN PERNAH mulai dari: intro, salam, "halo guys", penjelasan panjang

### 3. PACING CEPAT (Visual Movement)
- ✅ Ada perubahan di layar SETIAP 2-3 DETIK:
  - Ganti angle kamera / Zoom in/out / Gerakan cepat
  - Reaksi wajah berubah / Aksi/kejadian baru
- ❌ TOLAK momen statis/diam > 3 detik

### 4. TARGET METRIK VIRAL
Pilih HANYA klip yang bisa mencapai:
- ✅ **Viewed vs Swiped > 70%** (7 dari 10 orang nonton sampai habis)
- ✅ **Audience Retention > 100%** (orang nonton ulang/loop)
- ✅ **High Share Potential** (orang mau share ke teman)

### 5. KONTEN YANG VIRAL
Prioritaskan momen dengan:
- ✅ **Emosi kuat**: Lucu, kaget, terharu, marah, takjub
- ✅ **Relatable**: Pengalaman yang banyak orang alami
- ✅ **Solutif**: Memecahkan masalah sehari-hari (tips/tutorial)
- ✅ **Unexpected twist**: Plot twist yang bikin "WOW!"
- ❌ HINDARI: Konten membosankan, terlalu umum, sudah sering dilihat

### 6. SEAMLESS LOOP (untuk video 10-15 detik)
- ✅ Akhir video bisa nyambung mulus ke awal
- ✅ Bikin penonton tidak sadar video sudah loop

## FRAMEWORK: Hook → Tension → Payoff
1. **HOOK (Detik 1-3)**: Langsung momen paling menarik
2. **TENSION (Detik 3-30)**: Build up yang bikin penasaran
3. **PAYOFF (Detik terakhir)**: Klimaks yang memuaskan

## FORMAT OUTPUT:
- Title: Clickbait SINGKAT (maks 40 karakter), pakai emoji
- Hook: Kalimat pembuka yang langsung "mencolok" di 1 detik pertama
- Description: Kalimat MEMANCING KOMENTAR (contoh: "Setuju gak? 🤔")
- Tags: 5 hashtag trending + niche
- viralScore: Skor 1-100 (HANYA beri skor > 80 jika SEMUA kriteria terpenuhi)

## ⚠️ PENTING:
- Jika tidak ada klip yang memenuhi SEMUA kriteria, lebih baik return SEDIKIT klip berkualitas tinggi
- JANGAN paksa buat klip dari momen yang biasa-biasa saja
- Prioritas: KUALITAS > KUANTITAS

Respons WAJIB dalam Bahasa Indonesia. Format JSON murni.
    `;
    let userSettings = { gemini_key: '', openai_key: '', groq_key: '' };
    if (userId) {
      try { userSettings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId) as any || userSettings; } catch (e) { }
    }

    const geminiKeys = [userSettings.gemini_key, process.env.GEMINI_API_KEY].join(',').split(',').map(k => k.trim()).filter(Boolean);
    const groqKeys = [userSettings.groq_key, process.env.GROQ_API_KEY].join(',').split(',').map(k => k.trim()).filter(Boolean);
    const openAIKeys = [userSettings.openai_key, process.env.OPENAI_API_KEY].join(',').split(',').map(k => k.trim()).filter(Boolean);
    
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';
    const ollamaEnabled = process.env.OLLAMA_ENABLED === 'true';

    if (geminiKeys.length === 0 && groqKeys.length === 0 && openAIKeys.length === 0 && !ollamaEnabled) {
      throw new Error("Tidak ada API Key yang disimpan di Pengaturan. Silakan isi API Key terlebih dahulu.");
    }

    const { Type } = await import('@google/genai');
    const { default: Groq } = await import('groq-sdk');
    const { default: OpenAI } = await import('openai');
    const geminiModels = ['gemini-3.5-flash', 'gemini-3.1-pro', 'gemini-2.0-flash'];
    const maxRetries = 2;

    // Helper to parse varying JSON outputs (Array vs { clips: [...] })
    const parseClips = (text: string) => {
      let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      let parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed : (parsed.clips || Object.values(parsed)[0] || []);
    };

    const enhancedPrompt = prompt + `\n\nSANGAT PENTING: Output Anda HARUS berupa JSON valid dengan bentuk object yang membungkus array clips seperti ini:
{
  "clips": [
    {
      "title": "Judul Clickbait",
      "hook": "Hook kalimat 3 detik pertama",
      "description": "Deskripsi YouTube",
      "tags": ["#roblox", "#viral"],
      "viralScore": 95,
      "startTimeSeconds": 15,
      "endTimeSeconds": 30,
      "viralAnalysis": "Alasan klip ini viral..."
    }
  ]
}
Pastikan startTimeSeconds dan endTimeSeconds adalah ANGKA INTEGER.`;

    // 0. Try OLLAMA (100% Local, Free, Unlimited) if enabled
    if (ollamaEnabled) {
      try {
        const ollamaClient = new OpenAI({
          apiKey: 'ollama',
          baseURL: `${ollamaBaseUrl}/v1`,
          timeout: 120000, // 120s timeout for slower local models
        });
        const response = await ollamaClient.chat.completions.create({
          model: ollamaModel,
          messages: [{ role: 'user', content: enhancedPrompt }],
        });
        const content = response.choices[0]?.message?.content || '';
        const clips = parseClips(content);
        console.log(`[AI] Success with Ollama (${ollamaModel}) — Local & Unlimited!`);
        return clips.sort((a: any, b: any) => (b.viralScore || 0) - (a.viralScore || 0));
      } catch (err: any) {
        console.log(`[AI] Ollama failed (${err.message}). Falling back to cloud API...`);
      }
    }

    // 1. Try GROQ (Llama 3.3) if keys exist (Fastest, very generous free tier)
    for (let keyIdx = 0; keyIdx < groqKeys.length; keyIdx++) {
      const groq = new Groq({ apiKey: groqKeys[keyIdx] });
      const model = 'llama-3.3-70b-versatile';

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const response = await groq.chat.completions.create({
            model: model,
            messages: [{ role: 'user', content: enhancedPrompt }],
            response_format: { type: 'json_object' }
          });
          const clips = parseClips(response.choices[0]?.message?.content || '[]');
          console.log(`[AI] Success with Groq ${model} (Key #${keyIdx + 1}) on attempt ${attempt + 1}`);
          return clips.sort((a: any, b: any) => (b.viralScore || 0) - (a.viralScore || 0));
        } catch (err: any) {
          const isRateLimit = err?.status === 429;
          if (isRateLimit && attempt < maxRetries - 1) {
            const waitSec = Math.pow(2, attempt + 1) * 3;
            console.log(`[AI] Rate limited on Groq ${model} (Key #${keyIdx + 1}), retrying in ${waitSec}s...`);
            await new Promise(r => setTimeout(r, waitSec * 1000));
          } else {
            console.log(`[AI] Groq Model ${model} returned error/limit on Key #${keyIdx + 1}: ${err.message}. Moving on.`);
            break;
          }
        }
      }
    }

    // 2. Fallback to GEMINI
    for (let keyIdx = 0; keyIdx < geminiKeys.length; keyIdx++) {
      const aiClient = new GoogleGenAI({ apiKey: geminiKeys[keyIdx] });

      for (const model of geminiModels) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            const response = await aiClient.models.generateContent({
              model: model,
              contents: enhancedPrompt,
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    clips: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          title: { type: Type.STRING },
                          hook: { type: Type.STRING },
                          description: { type: Type.STRING },
                          tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                          viralScore: { type: Type.NUMBER },
                          startTimeSeconds: { type: Type.NUMBER },
                          endTimeSeconds: { type: Type.NUMBER },
                        },
                        required: ['title', 'hook', 'description', 'tags', 'viralScore', 'startTimeSeconds', 'endTimeSeconds'],
                      }
                    }
                  }
                },
              },
            });
            const clips = parseClips(response.text || '[]');
            console.log(`[AI] Success with Gemini ${model} (Key #${keyIdx + 1}) on attempt ${attempt + 1}`);
            return clips.sort((a: any, b: any) => (b.viralScore || 0) - (a.viralScore || 0));
          } catch (err: any) {
            const isRateLimit = err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED') || err?.status === 429;
            if (isRateLimit && attempt < maxRetries - 1) {
              const waitSec = Math.pow(2, attempt + 1) * 3;
              console.log(`[AI] Rate limited on Gemini ${model} (Key #${keyIdx + 1}), retrying in ${waitSec}s...`);
              await new Promise(r => setTimeout(r, waitSec * 1000));
            } else if (isRateLimit) {
              console.log(`[AI] Gemini ${model} rate limits exhausted on Key #${keyIdx + 1}.`);
              break;
            } else {
              console.log(`[AI] Gemini ${model} returned error: ${err.message}.`);
              break;
            }
          }
        }
      }
    }

    // 3. Fallback to OpenAI (ChatGPT)
    for (let keyIdx = 0; keyIdx < openAIKeys.length; keyIdx++) {
      const openai = new OpenAI({ apiKey: openAIKeys[keyIdx] });
      const model = 'gpt-4o-mini';

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const response = await openai.chat.completions.create({
            model: model,
            messages: [{ role: 'user', content: enhancedPrompt }],
            response_format: { type: 'json_object' }
          });
          const clips = parseClips(response.choices[0]?.message?.content || '[]');
          console.log(`[AI] Success with OpenAI ${model} (Key #${keyIdx + 1}) on attempt ${attempt + 1}`);
          return clips.sort((a: any, b: any) => (b.viralScore || 0) - (a.viralScore || 0));
        } catch (err: any) {
          const isRateLimit = err?.status === 429 || err?.message?.includes('insufficient_quota');
          if (isRateLimit && attempt < maxRetries - 1) {
            const waitSec = Math.pow(2, attempt + 1) * 3;
            console.log(`[AI] Rate limited on OpenAI ${model} (Key #${keyIdx + 1}), retrying in ${waitSec}s...`);
            await new Promise(r => setTimeout(r, waitSec * 1000));
          } else {
            console.log(`[AI] OpenAI Model ${model} returned error/limit on Key #${keyIdx + 1}: ${err.message}. Moving on.`);
            break;
          }
        }
      }
    }

    throw new Error(`Semua kuota habis! Telah mencoba ${groqKeys.length} Groq, ${openAIKeys.length} OpenAI, dan ${geminiKeys.length} Gemini API Key. Silakan tambah saldo atau tunggu reset.`);
  }

  // === UPLOAD A SINGLE CLIP TO YOUTUBE SHORTS ===
  async function uploadClipToYoutube(
    youtubeClient: any,
    sourceUrl: string,
    clip: { title: string; hook: string; description: string; tags: string[]; startTimeSeconds: number; endTimeSeconds: number },
    userId: number
  ) {
    const startSec = clip.startTimeSeconds;
    const endSec = clip.endTimeSeconds;
    const startIso = new Date(startSec * 1000).toISOString().substring(11, 19);
    const endIso = new Date(endSec * 1000).toISOString().substring(11, 19);
    const sectionStr = `*${startIso}-${endIso}`;

    // 1. Download clip segment
    const tempSegPath = path.join(os.tmpdir(), `autopilot_seg_${Date.now()}.mp4`);
    await youtubedl(sourceUrl, {
      format: 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
      downloadSections: sectionStr,
      forceKeyframesAtCuts: true,
      output: tempSegPath,
      noWarnings: true,
      noCheckCertificates: true,
      extractorArgs: 'youtube:player_client=android',
      ffmpegLocation: ffmpegStatic as string,
    } as any);

    // 2. Re-encode portrait (9:16) with face tracking + TikTok subtitles
    const tempOutPath = path.join(os.tmpdir(), `autopilot_out_${Date.now()}.mp4`);
    const faceTimeline = await runFaceTimeline(tempSegPath);
    const cropFilter = faceTimeline
      ? `sendcmd=f='${faceTimeline.cmdsPath.replace(/\\/g, '/').replace(':', '\\:')}',crop=${faceTimeline.crop_w}:${faceTimeline.crop_h}`
      : 'crop=ih*9/16:ih';

    // Get video info for subtitles (DISABLED: User requested to turn off auto-titles for Auto-Pilot as they cover the video)
    // const clipInfo = await youtubedl(sourceUrl, {
    //   dumpSingleJson: true, noCheckCertificates: true, noWarnings: true,
    //   extractorArgs: 'youtube:player_client=android'
    // } as any) as any;
    // const subInfo = await prepareSubtitles(clipInfo, clip.startTimeSeconds, 'tiktok');
    const subInfo = null;

    // Build filter chain: face crop (subtitles disabled)
    const filters: string[] = [cropFilter];
    if (subInfo) {
      filters.push(`subtitles='${(subInfo as any).ffmpegPath}':force_style='${getSubtitleStyle('tiktok')}'`);
    }

    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempSegPath)
        .videoFilters(filters)
        .outputOptions([
          '-c:v libx264',
          '-crf 18',  // Kualitas lebih tinggi (dari 20 ke 18, semakin rendah semakin bagus)
          '-preset medium',  // Preset lebih baik (dari veryfast ke medium)
          '-profile:v high',  // Profile high untuk kualitas maksimal
          '-level 4.2',
          '-pix_fmt yuv420p',
          '-movflags +faststart',
          '-c:a aac',
          '-b:a 256k',  // Audio bitrate lebih tinggi (dari 192k ke 256k)
          '-ar 48000'  // Sample rate 48kHz
        ])
        .save(tempOutPath)
        .on('end', () => {
          if (subInfo && fs.existsSync(subInfo.rawPath)) fs.unlinkSync(subInfo.rawPath);
          resolve();
        })
        .on('error', reject);
    });

    if (fs.existsSync(tempSegPath)) fs.unlinkSync(tempSegPath);
    if (faceTimeline && fs.existsSync(faceTimeline.cmdsPath)) fs.unlinkSync(faceTimeline.cmdsPath);

    // 3. Upload video to YouTube Shorts
    const response = await youtubeClient.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: clip.title.substring(0, 100),
          description: `${clip.description}\n\n${clip.hook}\n\n#shorts #viralclipai`,
          tags: clip.tags,
          categoryId: '22',
        },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      },
      media: { body: fs.createReadStream(tempOutPath) },
    });

    const videoId = response.data.id!;

    // 4. Auto-generate and upload clickbait thumbnail
    try {
      const thumbPath = await generateThumbnailPy(tempOutPath, clip.title, clip.hook);
      if (thumbPath) {
        await youtubeClient.thumbnails.set({
          videoId,
          media: { mimeType: 'image/jpeg', body: fs.createReadStream(thumbPath) },
        });
        fs.unlinkSync(thumbPath);
      }
    } catch (thumbErr) {
      console.warn('[Autopilot] Thumbnail skipped:', thumbErr);
    }

    if (fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath);
    return videoId;
  }

  const runWatcher = async () => {
    if (watcherStatus.isChecking) return;
    watcherStatus.isChecking = true;
    watcherStatus.lastChecked = new Date().toISOString();

    try {
      const users = db.prepare('SELECT * FROM users').all() as any[];
      for (const user of users) {
        const channels = db.prepare('SELECT channel_id FROM channels WHERE user_id = ?').all(user.id) as any[];
        if (channels.length === 0) continue;

        const tokenRow = db.prepare('SELECT tokens FROM tokens WHERE user_id = ?').get(user.id) as any;
        if (!tokenRow) continue;

        const userOauth = getOAuthClient(user.id);
        userOauth.setCredentials(JSON.parse(tokenRow.tokens));
        const youtube = google.youtube({ version: 'v3', auth: userOauth });

        for (const chan of channels) {
          const channelId = chan.channel_id;
          try {
            addWatcherLog(`Checking channel ${channelId} for user ${user.email}...`);

            // Support both @handle and UC... channel IDs
            let chanRes;
            if (channelId.startsWith('@')) {
              chanRes = await youtube.channels.list({ part: ['contentDetails', 'snippet'], forHandle: channelId.substring(1) });
            } else {
              chanRes = await youtube.channels.list({ part: ['contentDetails', 'snippet'], id: [channelId] });
            }
            const uploadsId = chanRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
            if (!uploadsId) {
              addWatcherLog(`⚠️ Could not find uploads playlist for ${channelId}. Check if the channel name is correct.`);
              continue;
            }

            // Paginate through the ENTIRE uploads playlist to find ALL unprocessed videos
            const allItems: any[] = [];
            let pageToken: string | undefined = undefined;
            do {
              const playRes: any = await youtube.playlistItems.list({
                part: ['snippet', 'contentDetails'],
                playlistId: uploadsId,
                maxResults: 50,
                pageToken,
              });
              allItems.push(...(playRes.data.items || []));
              pageToken = playRes.data.nextPageToken || undefined;
            } while (pageToken);

            const newVideos = allItems.filter(item => {
              const vid = item.contentDetails?.videoId as string;
              return !db.prepare('SELECT 1 FROM processed_videos WHERE user_id = ? AND video_id = ?').get(user.id, vid);
            });

            if (newVideos.length === 0) {
              addWatcherLog(`No unprocessed videos on channel ${channelId}.`);
              continue;
            }

            addWatcherLog(`Found ${newVideos.length} unprocessed video(s) on ${channelId} (incl. old ones).`);


            for (const video of newVideos.slice(0, 3)) { // max 3 per watcher run

              const videoId = video.contentDetails?.videoId as string;
              const videoTitle = video.snippet?.title || 'Untitled';
              const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;

              // Don't mark as processed yet — only mark AFTER successful upload
              saveToHistory(user.id, { type: 'auto_process', title: videoTitle, url: sourceUrl, status: 'processing' });

              try {
                // 1. Get transcript
                addWatcherLog(`Fetching transcript for: ${videoTitle}`);
                const info = await youtubedl(sourceUrl, {
                  dumpSingleJson: true,
                  noCheckCertificates: true,
                  noWarnings: true,
                  extractorArgs: 'youtube:player_client=android'
                } as any) as any;

                let transcript = '';
                const langs = ['id', 'en'];
                for (const source of [info.subtitles, info.automatic_captions]) {
                  if (!source) continue;
                  for (const lang of langs) {
                    if (source[lang]) {
                      const track = source[lang].find((s: any) => s.ext === 'vtt' || s.ext === 'srt');
                      if (track) {
                        const subRes = await fetch(track.url);
                        const raw = await subRes.text();
                        transcript = raw.replace(/<[^>]+>/g, '').replace(/^\d+\n/gm, '');
                        break;
                      }
                    }
                  }
                  if (transcript) break;
                }

                if (!transcript) {
                  addWatcherLog(`No transcript for ${videoTitle}, skipping.`);
                  continue;
                }

                // 2. AI analyze top 2 clips
                addWatcherLog(`AI analyzing clips for: ${videoTitle}`);
                const clips = await analyzeClipsServer(sourceUrl, videoTitle, transcript, 2, user.id);
                if (!clips || clips.length === 0) {
                  addWatcherLog(`No clips generated for ${videoTitle}.`);
                  continue;
                }

                // 3. Upload each clip
                for (const clip of clips) {
                  addWatcherLog(`Uploading clip: ${clip.title}`);
                  try {
                    const uploadedId = await uploadClipToYoutube(youtube, sourceUrl, clip, user.id);
                    saveToHistory(user.id, {
                      type: 'auto_process', title: clip.title,
                      url: `https://youtube.com/shorts/${uploadedId}`,
                      details: { videoId: uploadedId, sourceVideo: videoTitle },
                      status: 'success'
                    });
                    addWatcherLog(`✅ Uploaded Shorts: https://youtube.com/shorts/${uploadedId}`);
                  } catch (clipErr: any) {
                    addWatcherLog(`❌ Failed clip "${clip.title}": ${clipErr.message}`);
                    saveToHistory(user.id, { type: 'auto_process', title: clip.title, url: sourceUrl, status: 'error' });
                  }
                }
                // Mark video as processed ONLY after all clips attempted successfully
                db.prepare('INSERT OR IGNORE INTO processed_videos (user_id, video_id) VALUES (?, ?)').run(user.id, videoId);
                addWatcherLog(`✅ Finished processing: ${videoTitle}`);
              } catch (videoErr: any) {
                addWatcherLog(`❌ Error processing ${videoTitle}: ${videoErr.message} — will retry next run`);
              }
            }
          } catch (chanErr: any) {
            addWatcherLog(`Error on channel ${channelId}: ${chanErr.message}`);
          }
        }
      }
      addWatcherLog('Periodic check complete.');
    } catch (error: any) {
      addWatcherLog(`Global Watcher Error: ${error.message}`);
    } finally {
      watcherStatus.isChecking = false;
    }
  };

  runWatcher();
  setInterval(runWatcher, 10 * 60 * 1000);

  // Auth Routes
  app.post("/api/auth/register", express.json(), async (req, res) => {
    try {
      const { email, password } = req.body;
      const userId = await register(email, password);
      res.json({ success: true, userId });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/auth/login", express.json(), async (req, res) => {
    try {
      const data = await login(req.body.email, req.body.password);
      res.json(data);
    } catch (e: any) { res.status(401).json({ error: e.message }); }
  });

  app.get("/api/auth/status", authMiddleware, (req: any, res) => {
    const tokens = db.prepare('SELECT tokens FROM tokens WHERE user_id = ?').get(req.user.id) as any;
    res.json({ connected: !!tokens });
  });

  // YouTube OAuth
  app.get("/api/auth/youtube", authMiddleware, (req: any, res) => {
    try {
      const oauthClient = getOAuthClient(req.user.id);
      const url = oauthClient.generateAuthUrl({
        access_type: "offline",
        scope: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
        prompt: "consent",
        state: req.user.id.toString()
      });
      res.json({ url });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/auth/youtube/callback", async (req, res) => {
    const { code, state: userId } = req.query;
    try {
      if (!userId) throw new Error("No user ID in state");
      const oauthClient = getOAuthClient(Number(userId));
      const { tokens } = await oauthClient.getToken(code as string);
      db.prepare('INSERT OR REPLACE INTO tokens (user_id, tokens) VALUES (?, ?)').run(Number(userId), JSON.stringify(tokens));
      res.redirect(`http://localhost:3000/?connected=youtube`);
    } catch (error) { res.redirect(`http://localhost:3000/?error=auth_failed`); }
  });

  // Protected API
  app.get("/api/history", authMiddleware, (req: any, res) => {
    const history = db.prepare('SELECT * FROM history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50').all(req.user.id);
    res.json(history.map((h: any) => ({ ...h, details: JSON.parse(h.details || '{}') })));
  });

  app.get("/api/v2/watcher/list", authMiddleware, (req: any, res) => {
    const channels = db.prepare('SELECT channel_id FROM channels WHERE user_id = ?').all(req.user.id);
    res.json(channels.map((c: any) => c.channel_id));
  });

  app.post("/api/v2/watcher/add", authMiddleware, express.json(), (req: any, res) => {
    db.prepare('INSERT OR IGNORE INTO channels (user_id, channel_id) VALUES (?, ?)').run(req.user.id, req.body.channelId);
    res.json({ success: true });
  });

  app.post("/api/v2/watcher/remove", authMiddleware, express.json(), (req: any, res) => {
    db.prepare('DELETE FROM channels WHERE user_id = ? AND channel_id = ?').run(req.user.id, req.body.channelId);
    res.json({ success: true });
  });

  app.get("/api/v2/watcher/status", authMiddleware, (req: any, res) => {
    res.json(watcherStatus);
  });

  app.post("/api/v2/watcher/run", authMiddleware, (req: any, res) => {
    if (watcherStatus.isChecking) return res.status(400).json({ error: "Watcher is already running" });
    runWatcher();
    res.json({ success: true });
  });


  app.get("/api/video-info", authMiddleware, async (req, res) => {
    try {
      const info = await youtubedl(req.query.url as string, { dumpJson: true, noWarnings: true, noCheckCertificates: true, extractorArgs: 'youtube:player_client=android' } as any);
      const data = typeof info === "string" ? JSON.parse(info) : info;
      res.json({ title: data.title, description: data.description, uploader: data.uploader, duration: data.duration });
    } catch (err: any) { res.status(500).json({ error: "Failed to fetch video metadata" }); }
  });

  app.get("/api/transcript", authMiddleware, async (req, res) => {
    try {
      const { url } = req.query;
      const info = await youtubedl(url as string, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, extractorArgs: 'youtube:player_client=android' } as any) as any;
      let subUrl = null;
      const langs = ['id', 'en'];
      for (const source of [info.subtitles, info.automatic_captions]) {
        if (!source) continue;
        for (const lang of langs) {
          if (source[lang]) {
            const track = source[lang].find((s: any) => s.ext === 'vtt' || s.ext === 'srt');
            if (track) { subUrl = track.url; break; }
          }
        }
        if (subUrl) break;
      }

      if (!subUrl) return res.json({ transcript: "" });

      const subRes = await fetch(subUrl);
      const text = await subRes.text();

      const lines = text.split('\n');
      let transcript = '';
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('-->')) {
          const time = lines[i].split(' ')[0].substring(0, 8); // 00:00:00
          if (lines[i + 1] && lines[i + 1].trim() !== '') {
            const cleanText = lines[i + 1].replace(/<[^>]+>/g, '').trim();
            if (cleanText) transcript += `[${time}] ${cleanText}\n`;
          }
        }
      }
      res.json({ transcript });
    } catch (err: any) {
      console.error("Transcript Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/download-clip", authMiddleware, async (req: any, res) => {
    try {
      const { url, start, end, format, quality, useSubtitles, captionStyle, videoMode } = req.query;

      const startSec = parseFloat(start as string);
      const endSec = parseFloat(end as string);
      const startIso = new Date(startSec * 1000).toISOString().substring(11, 19);
      const endIso = new Date(endSec * 1000).toISOString().substring(11, 19);
      const sectionStr = `*${startIso}-${endIso}`;

      const info = await youtubedl(url as string, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, extractorArgs: 'youtube:player_client=android' } as any) as any;
      const title = info.title ? info.title.replace(/[^a-zA-Z0-9]/g, "_") : "video";
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", contentDisposition(`clip_${title}.mp4`));

      const ytdlFormat = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best';
      const tempVideoPath = path.join(os.tmpdir(), `temp_seg_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`);

      await youtubedl(url as string, {
        format: ytdlFormat,
        downloadSections: sectionStr,
        forceKeyframesAtCuts: true,
        output: tempVideoPath,
        noWarnings: true,
        noCheckCertificates: true,
        extractorArgs: 'youtube:player_client=android',
        ffmpegLocation: ffmpegStatic as string
      } as any);

      const style = (captionStyle === 'tiktok') ? 'tiktok' : 'normal';
      const subInfo = (useSubtitles === 'true' || useSubtitles === true) ? await prepareSubtitles(info, startSec, style) : null;

      // Face tracking or Split Screen
      let faceTimeline: { cmdsPath: string; crop_w: number; crop_h: number } | null = null;
      if (format === 'portrait' && videoMode === 'reframe') {
        faceTimeline = await runFaceTimeline(tempVideoPath);
      }

      let job = ffmpeg(tempVideoPath).format("mp4").outputOptions([
        "-c:v libx264",
        "-crf 18",  // Kualitas lebih tinggi
        "-preset medium",  // Preset lebih baik untuk kualitas
        "-profile:v high",
        "-level 4.2",
        "-pix_fmt yuv420p",
        "-c:a aac",
        "-b:a 256k",  // Audio bitrate lebih tinggi
        "-ar 48000",
        "-movflags frag_keyframe+empty_moov+faststart"
      ]);

      if (format === 'portrait') {
        if (videoMode === 'split') {
          let complex = `[0:v]split[top][bottom];[top]crop=iw/2:ih:0:0,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[t];[bottom]crop=iw/2:ih:iw/2:0,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[b];[t][b]vstack=inputs=2[vid]`;
          if (subInfo) {
            complex += `;[vid]subtitles='${subInfo.ffmpegPath}':force_style='${getSubtitleStyle(style)}'[vfinal]`;
            job = job.complexFilter(complex, 'vfinal');
          } else {
            job = job.complexFilter(complex, 'vid');
          }
        } else {
          const filters: string[] = [];
          if (videoMode === 'reframe' && faceTimeline) {
            const cmdsEsc = faceTimeline.cmdsPath.replace(/\\/g, '/').replace(':', '\\:');
            filters.push(`sendcmd=f='${cmdsEsc}',crop=${faceTimeline.crop_w}:${faceTimeline.crop_h}`);
          } else {
            filters.push('crop=ih*9/16:ih'); // centre crop fallback
          }
          if (subInfo) filters.push(`subtitles='${subInfo.ffmpegPath}':force_style='${getSubtitleStyle(style)}'`);
          job = job.videoFilters(filters);
        }
      } else {
        if (subInfo) job = job.videoFilters([`subtitles='${subInfo.ffmpegPath}':force_style='${getSubtitleStyle(style)}'`]);
      }

      job
        .on("end", () => {
          if (subInfo && fs.existsSync(subInfo.rawPath)) fs.unlinkSync(subInfo.rawPath);
          if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
          if (faceTimeline && fs.existsSync(faceTimeline.cmdsPath)) fs.unlinkSync(faceTimeline.cmdsPath);
          saveToHistory(req.user.id, { type: 'download', title, url, status: 'success' });
        })
        .on("error", (err: any) => {
          if (subInfo && fs.existsSync(subInfo.rawPath)) fs.unlinkSync(subInfo.rawPath);
          if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
          if (faceTimeline && fs.existsSync(faceTimeline.cmdsPath)) fs.unlinkSync(faceTimeline.cmdsPath);
        });

      job.pipe(res, { end: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });


  app.get("/api/thumbnail/extract", authMiddleware, async (req, res) => {
    try {
      const info = await youtubedl(req.query.url as string, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, extractorArgs: 'youtube:player_client=android' } as any);
      const videoUrl = (info as any).url;
      res.setHeader('Content-Type', 'image/jpeg');
      ffmpeg(videoUrl).setFfmpegPath(ffmpegStatic as string).seekInput(Number(req.query.time) || 0).frames(1).format('image2').pipe(res, { end: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/upload/youtube", authMiddleware, express.json(), async (req: any, res) => {
    try {
      const { url, start, end, format, title, description, tags, quality, useSubtitles, captionStyle, videoMode } = req.body;

      const tokenRow = db.prepare('SELECT tokens FROM tokens WHERE user_id = ?').get(req.user.id) as any;
      if (!tokenRow) return res.status(401).json({ error: "YouTube not connected" });
      const userOauth = getOAuthClient(req.user.id);
      userOauth.setCredentials(JSON.parse(tokenRow.tokens));
      const startSec = parseFloat(start as string);
      const endSec = parseFloat(end as string);
      const startIso = new Date(startSec * 1000).toISOString().substring(11, 19);
      const endIso = new Date(endSec * 1000).toISOString().substring(11, 19);
      const sectionStr = `*${startIso}-${endIso}`;

      const info = await youtubedl(url as string, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, extractorArgs: 'youtube:player_client=android' } as any) as any;
      const ytdlFormat = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best';
      const tempVideoPath = path.join(os.tmpdir(), `temp_seg_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`);

      await youtubedl(url as string, {
        format: ytdlFormat,
        downloadSections: sectionStr,
        forceKeyframesAtCuts: true,
        output: tempVideoPath,
        noWarnings: true,
        noCheckCertificates: true,
        extractorArgs: 'youtube:player_client=android',
        ffmpegLocation: ffmpegStatic as string
      } as any);

      const tempPath = path.join(os.tmpdir(), `temp_upload_${Date.now()}.mp4`);

      const capStyle2 = (captionStyle === 'tiktok') ? 'tiktok' : 'normal';
      const subInfo2 = (useSubtitles === 'true' || useSubtitles === true) ? await prepareSubtitles(info, startSec, capStyle2) : null;

      let faceTimeline2: { cmdsPath: string; crop_w: number; crop_h: number } | null = null;
      if (format === 'portrait' && videoMode === 'reframe') {
        faceTimeline2 = await runFaceTimeline(tempVideoPath);
      }

      let job2 = ffmpeg(tempVideoPath).format("mp4").outputOptions([
        "-c:v libx264",
        "-crf 18",  // Kualitas lebih tinggi
        "-preset medium",  // Preset lebih baik untuk kualitas
        "-profile:v high",
        "-level 4.2",
        "-pix_fmt yuv420p",
        "-c:a aac",
        "-b:a 256k",  // Audio bitrate lebih tinggi
        "-ar 48000",
        "-movflags frag_keyframe+empty_moov+faststart"
      ]);

      if (format === 'portrait') {
        if (videoMode === 'split') {
          let complex = `[0:v]split[top][bottom];[top]crop=iw/2:ih:0:0,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[t];[bottom]crop=iw/2:ih:iw/2:0,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[b];[t][b]vstack=inputs=2[vid]`;
          if (subInfo2) {
            complex += `;[vid]subtitles='${subInfo2.ffmpegPath}':force_style='${getSubtitleStyle(capStyle2)}'[vfinal]`;
            job2 = job2.complexFilter(complex, 'vfinal');
          } else {
            job2 = job2.complexFilter(complex, 'vid');
          }
        } else {
          const filters2: string[] = [];
          if (videoMode === 'reframe' && faceTimeline2) {
            const cmdsEsc2 = faceTimeline2.cmdsPath.replace(/\\/g, '/').replace(':', '\\:');
            filters2.push(`sendcmd=f='${cmdsEsc2}',crop=${faceTimeline2.crop_w}:${faceTimeline2.crop_h}`);
          } else {
            filters2.push('crop=ih*9/16:ih');
          }
          if (subInfo2) filters2.push(`subtitles='${subInfo2.ffmpegPath}':force_style='${getSubtitleStyle(capStyle2)}'`);
          job2 = job2.videoFilters(filters2);
        }
      } else {
        if (subInfo2) job2 = job2.videoFilters([`subtitles='${subInfo2.ffmpegPath}':force_style='${getSubtitleStyle(capStyle2)}'`]);
      }

      job2.save(tempPath).on('end', async () => {
        if (subInfo2 && fs.existsSync(subInfo2.rawPath)) fs.unlinkSync(subInfo2.rawPath);
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (faceTimeline2 && fs.existsSync(faceTimeline2.cmdsPath)) fs.unlinkSync(faceTimeline2.cmdsPath);

        try {
          const youtube = google.youtube({ version: "v3", auth: userOauth });
          const response = await youtube.videos.insert({
            part: ["snippet", "status"],
            requestBody: {
              snippet: { title: title.substring(0, 100), description: `${description}\n\n#shorts #viralclipai`, tags, categoryId: "22" },
              status: { privacyStatus: "public", selfDeclaredMadeForKids: false }
            },
            media: { body: fs.createReadStream(tempPath) }
          });
          const videoId = response.data.id!;

          // Auto-generate and upload clickbait thumbnail
          try {
            const hook = description?.split(' ').slice(0, 5).join(' ') || '';
            const thumbPath = await generateThumbnailPy(tempPath, title, hook);
            if (thumbPath) {
              await youtube.thumbnails.set({
                videoId,
                media: { mimeType: 'image/jpeg', body: require('fs').createReadStream(thumbPath) }
              });
              fs.unlinkSync(thumbPath);
            }
          } catch (thumbErr) {
            console.warn('Thumbnail upload skipped:', thumbErr);
          }

          fs.unlinkSync(tempPath);
          saveToHistory(req.user.id, { type: 'upload', title, url, videoId, status: 'success' });
          res.json({ success: true, videoId });
        } catch (uploadErr: any) {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          saveToHistory(req.user.id, { type: 'upload', title, url, status: 'error' });
          res.status(500).json({ error: uploadErr.message });
        }
      }).on('error', (err: any) => {
        if (subInfo2 && fs.existsSync(subInfo2.rawPath)) fs.unlinkSync(subInfo2.rawPath);
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (faceTimeline2 && fs.existsSync(faceTimeline2.cmdsPath)) fs.unlinkSync(faceTimeline2.cmdsPath);

        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        res.status(500).json({ error: err.message });
      });

    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });



  // === ENDPOINT: License System ===
  app.get("/api/license/status", async (req, res) => {
    try {
      const { machineIdSync } = await import('node-machine-id');
      const hwId = machineIdSync();
      const licenseRec = db.prepare('SELECT license_key FROM app_license WHERE id = 1').get() as any;
      if (!licenseRec || !licenseRec.license_key) {
        return res.json({ valid: false, reason: 'no_license_saved', hardware_id: hwId });
      }

      // Verify online
      const fetchResponse = await fetch('https://rhwebs.com/api/mobile/licenses/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: licenseRec.license_key, hardware_id: hwId })
      });
      
      const data = await fetchResponse.json();
      if (data.success) {
        return res.json({ valid: true, hardware_id: hwId, license_key: licenseRec.license_key });
      } else {
        return res.json({ valid: false, reason: data.error || 'invalid_license', hardware_id: hwId });
      }
    } catch (err: any) {
      console.error('License check error:', err.message);
      // If offline, we can either block or allow. Let's allow if a license is stored (offline mode)
      const licenseRec = db.prepare('SELECT license_key FROM app_license WHERE id = 1').get() as any;
      if (licenseRec && licenseRec.license_key) {
        return res.json({ valid: true, offline: true, warning: 'Could not connect to license server.' });
      }
      res.status(500).json({ error: 'Gagal mengecek lisensi (offline).' });
    }
  });

  app.post("/api/license/activate", express.json(), async (req, res) => {
    try {
      const { license_key } = req.body;
      if (!license_key) return res.status(400).json({ error: "License key is required" });

      const { machineIdSync } = await import('node-machine-id');
      const hwId = machineIdSync();

      const fetchResponse = await fetch('https://rhwebs.com/api/mobile/licenses/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key, hardware_id: hwId })
      });

      const data = await fetchResponse.json();
      if (data.success) {
        // Save to DB
        db.prepare(`
          INSERT INTO app_license (id, license_key) VALUES (1, ?)
          ON CONFLICT(id) DO UPDATE SET license_key = excluded.license_key
        `).run(license_key);
        res.json({ success: true });
      } else {
        res.status(403).json({ error: data.error || 'Lisensi tidak valid atau sudah digunakan di perangkat lain.' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // === ENDPOINT: AI Clip Analysis (Groq → Gemini → OpenAI fallback) ===
  // Frontend calls this instead of hitting Gemini directly, so all API keys
  // and the full fallback chain are used server-side.
  app.post("/api/analyze-clips", authMiddleware, express.json(), async (req: any, res) => {
    try {
      const { url, videoTitle, transcript, count } = req.body;
      if (!url) return res.status(400).json({ error: "URL is required" });

      const clips = await analyzeClipsServer(
        url,
        videoTitle || "Untitled",
        transcript || "",
        count || 4,
        req.user.id
      );
      res.json({ clips });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // === ENDPOINT: Settings (API Keys) ===
  app.get("/api/settings", authMiddleware, (req: any, res) => {
    try {
      const settings = db.prepare('SELECT gemini_key, openai_key, groq_key, youtube_client_id, youtube_client_secret FROM settings WHERE user_id = ?').get(req.user.id) || {};
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/settings", authMiddleware, express.json(), (req: any, res) => {
    try {
      const { gemini_key, openai_key, groq_key, youtube_client_id, youtube_client_secret } = req.body;
      db.prepare(`
        INSERT INTO settings (user_id, gemini_key, openai_key, groq_key, youtube_client_id, youtube_client_secret)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
        gemini_key = excluded.gemini_key,
        openai_key = excluded.openai_key,
        groq_key = excluded.groq_key,
        youtube_client_id = excluded.youtube_client_id,
        youtube_client_secret = excluded.youtube_client_secret
      `).run(req.user.id, gemini_key || '', openai_key || '', groq_key || '', youtube_client_id || '', youtube_client_secret || '');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));


  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true, hmr: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}

startServer();
