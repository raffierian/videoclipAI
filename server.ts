import express from "express";
import { WebSocketServer } from 'ws';
import path from "path";
import youtubedlPkg from "youtube-dl-exec";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import contentDisposition from "content-disposition";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import nodeMachineId from "node-machine-id";
const { machineIdSync } = nodeMachineId;
import db from "./lib/db";
import { register, login, authMiddleware } from "./lib/auth";
import { prepareAssSubtitles } from "./lib/subtitles";

dotenv.config();

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isPackaged = __dirname.includes('app.asar');

// Resolve ffmpeg path
let resolvedFfmpegPath = ffmpegStatic as string;
if (isPackaged) resolvedFfmpegPath = resolvedFfmpegPath.replace('app.asar', 'app.asar.unpacked');
ffmpeg.setFfmpegPath(resolvedFfmpegPath);

// Resolve yt-dlp path
let ytdlpPath = '';
if (isPackaged) {
  ytdlpPath = path.join(__dirname, '..', '..', 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
} else {
  ytdlpPath = path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
}

import { spawn } from 'child_process';
const youtubedl = function(url: string, flags: any = {}) {
  return new Promise((resolve, reject) => {
    const args: string[] = [];
    for (const [key, value] of Object.entries(flags)) {
      if (value === false) continue;
      const param = '--' + key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
      if (value === true) args.push(param);
      else args.push(param, String(value));
    }
    args.push(url);
    
    const proc = spawn(ytdlpPath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => stdout += d.toString());
    proc.stderr.on('data', (d: Buffer) => stderr += d.toString());
    proc.on('close', code => {
      if (code === 0) {
        if (flags.dumpJson) {
          try { resolve(JSON.parse(stdout)); } catch (e) { resolve(stdout); }
        } else {
          resolve(stdout);
        }
      } else {
        reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      }
    });
    proc.on('error', reject);
  });
};

async function downloadYoutubeSegment(url: string, sectionStr: string, outputPath: string) {
  await youtubedl(url, {
    format: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
    mergeOutputFormat: 'mp4',
    downloadSections: sectionStr,
    forceKeyframesAtCuts: true,
    output: outputPath,
    noWarnings: true,
    noCheckCertificates: true,
    extractorArgs: 'youtube:player_client=android',
    ffmpegLocation: resolvedFfmpegPath
  } as any);
}

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
    const id = Date.now().toString() + Math.random().toString(36).substring(7);
    const stmt = db.prepare('INSERT INTO history (id, user_id, type, title, url, status, details) VALUES (?, ?, ?, ?, ?, ?, ?)');
    
    const details = { ...(entry.details || {}) };
    if (entry.videoId) details.videoId = entry.videoId;
    if (entry.sourceVideo) details.sourceVideo = entry.sourceVideo;
    if (entry.error) details.error = entry.error;

    stmt.run(
      id,
      userId,
      entry.type,
      entry.title || null,
      entry.url || null,
      entry.status || 'success',
      JSON.stringify(details)
    );
    return id;
  } catch (e) {
    console.error("Failed to save to history:", e);
    return null;
  }
}

// Helper to fetch and parse transcripts from video metadata (with rate limit check and language key priority)
async function fetchTranscript(info: any, includeTimestamps = false): Promise<string> {
  const sources = [info.subtitles, info.automatic_captions];
  
  const languageGroups = [
    (key: string) => key.startsWith('id'),
    (key: string) => key.startsWith('en'),
    () => true
  ];

  for (const source of sources) {
    if (!source) continue;
    
    for (const filterFn of languageGroups) {
      const matchingKeys = Object.keys(source).filter(filterFn);
      
      for (const key of matchingKeys) {
        const track = source[key]?.find((s: any) => s.ext === 'vtt' || s.ext === 'srt');
        if (!track || !track.url) continue;

        try {
          const subRes = await fetch(track.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          
          if (subRes.ok && subRes.status === 200) {
            const raw = await subRes.text();
            
            if (raw.includes('<title>Sorry...</title>') || raw.trim().startsWith('<html')) {
              console.warn(`[Transcript] Rate limited on track key ${key}`);
              continue;
            }

            const lines = raw.split('\n');
            let transcriptLines: string[] = [];
            
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              if (line.includes('-->')) {
                const time = line.split(' ')[0].substring(0, 8); // e.g. "00:00:05"
                let textLines: string[] = [];
                let j = i + 1;
                while (j < lines.length && !lines[j].includes('-->') && !/^\d+$/.test(lines[j].trim())) {
                  const txt = lines[j].replace(/<[^>]+>/g, '').trim();
                  if (txt) textLines.push(txt);
                  j++;
                }
                const text = textLines.join(' ');
                if (text) {
                  if (includeTimestamps) {
                    transcriptLines.push(`[${time}] ${text}`);
                  } else {
                    transcriptLines.push(text);
                  }
                }
                i = j - 1; // Advance loop
              }
            }

            const transcript = includeTimestamps ? transcriptLines.join('\n') : transcriptLines.join(' ');
            if (transcript.trim().length > 10) {
              return transcript;
            }
          }
        } catch (fetchErr: any) {
          console.warn(`[Transcript] Failed to fetch track key ${key}: ${fetchErr.message}`);
        }
      }
    }
  }

  return '';
}

// Fallback to transcribe audio of YouTube video if no transcript is found on YouTube
async function transcribeVideoAudio(sourceUrl: string, userId: number): Promise<string> {
  const tempAudioPath = path.join(os.tmpdir(), `temp_audio_${Date.now()}_${Math.floor(Math.random() * 1000)}.m4a`);
  
  try {
    console.log(`[Transcript Fallback] Downloading audio for fallback transcription: ${sourceUrl}`);
    await youtubedl(sourceUrl, {
      format: 'bestaudio[ext=m4a]/bestaudio/best',
      output: tempAudioPath,
      noWarnings: true,
      noCheckCertificates: true,
      extractorArgs: 'youtube:player_client=android',
      ffmpegLocation: resolvedFfmpegPath
    } as any);
  } catch (err: any) {
    console.error(`[Transcript Fallback] Failed to download audio: ${err.message}`);
    return '';
  }

  if (!fs.existsSync(tempAudioPath)) {
    console.error(`[Transcript Fallback] Audio file not found at ${tempAudioPath}`);
    return '';
  }

  let userSettings = { gemini_key: '', openai_key: '', groq_key: '' };
  if (userId) {
    try { userSettings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId) as any || userSettings; } catch (e) { }
  }
  const geminiKey = userSettings.gemini_key || process.env.GEMINI_API_KEY || '';
  const groqKey = userSettings.groq_key || process.env.GROQ_API_KEY || '';
  const openAIKey = userSettings.openai_key || process.env.OPENAI_API_KEY || '';

  try {
    // 1. Try Groq Whisper (Free & extremely fast)
    if (groqKey) {
      try {
        console.log(`[Transcript Fallback] Transcribing audio with Groq Whisper...`);
        const { default: Groq } = await import('groq-sdk');
        const groq = new Groq({ apiKey: groqKey });
        const transcription = await groq.audio.transcriptions.create({
          file: fs.createReadStream(tempAudioPath),
          model: "whisper-large-v3",
          response_format: "verbose_json",
        }) as any;
        if (transcription.segments && transcription.segments.length > 0) {
          const formatted = formatWhisperSegments(transcription.segments);
          if (formatted.length > 10) return formatted;
        }
      } catch (err: any) {
        console.warn(`[Transcript Fallback] Groq Whisper failed: ${err.message}`);
      }
    }

    // 2. Try OpenAI Whisper (Paid but accurate)
    if (openAIKey) {
      try {
        console.log(`[Transcript Fallback] Transcribing audio with OpenAI Whisper...`);
        const { default: OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey: openAIKey });
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(tempAudioPath),
          model: "whisper-1",
          response_format: "verbose_json",
        }) as any;
        if (transcription.segments && transcription.segments.length > 0) {
          const formatted = formatWhisperSegments(transcription.segments);
          if (formatted.length > 10) return formatted;
        }
      } catch (err: any) {
        console.warn(`[Transcript Fallback] OpenAI Whisper failed: ${err.message}`);
      }
    }

    // 3. Try Gemini 2.5 Flash inline base64 audio
    // Note: @google/genai v1.x removed files.upload; we use inlineData instead
    if (geminiKey) {
      try {
        console.log(`[Transcript Fallback] Transcribing audio with Gemini...`);
        const aiClient = new GoogleGenAI({ apiKey: geminiKey });

        // Read audio file as base64
        const audioBuffer = fs.readFileSync(tempAudioPath);
        const audioBase64 = audioBuffer.toString('base64');

        // Determine mime type from file extension
        const ext = path.extname(tempAudioPath).toLowerCase().replace('.', '');
        const mimeTypeMap: Record<string, string> = {
          'm4a': 'audio/mp4',
          'mp4': 'audio/mp4',
          'mp3': 'audio/mpeg',
          'ogg': 'audio/ogg',
          'opus': 'audio/opus',
          'wav': 'audio/wav',
          'flac': 'audio/flac',
          'aac': 'audio/aac',
          'webm': 'audio/webm',
        };
        const mimeType = mimeTypeMap[ext] || 'audio/mp4';

        const response = await aiClient.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{
            parts: [
              { inlineData: { mimeType, data: audioBase64 } },
              { text: "Transkripsikan audio video ini dengan format timestamp per detik/kalimat. Contoh: [00:00:05] Halo semuanya. [00:00:12] Hari ini kita akan... Berikan output HANYA teks transkripsi saja tanpa tambahan kata pembuka/penutup." }
            ]
          }]
        });

        const text = response.text || '';
        if (text.length > 10) {
          return text;
        }
      } catch (err: any) {
        console.warn(`[Transcript Fallback] Gemini Audio transcription failed:\n${err.stack}`);
      }
    }
  } finally {
    if (fs.existsSync(tempAudioPath)) {
      try { fs.unlinkSync(tempAudioPath); } catch {}
    }
  }

  return '';
}

function formatWhisperSegments(segments: any[]): string {
  return segments.map(seg => {
    const totalSec = Math.floor(seg.start);
    const h = Math.floor(totalSec / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    return `[${h}:${m}:${s}] ${seg.text.trim()}`;
  }).join('\n');
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


const venvPy = (() => {
  const isPackaged = __dirname.includes('app.asar');
  const appRoot = isPackaged ? path.join(__dirname, '..', '..') : path.join(__dirname, '..');
  const p = path.join(appRoot, '.venv', 'Scripts', 'python.exe');
  return fs.existsSync(p) ? p : 'python';
})();

function spawnPython(args: string[], timeoutMs = 120000): Promise<string | null> {
  return new Promise((resolve) => {
    const isPackaged = __dirname.includes('app.asar');
    const scriptsBase = isPackaged 
      ? path.join(__dirname, '..', '..', 'app.asar.unpacked', 'scripts')
      : path.join(__dirname, '..', 'scripts');
    const scriptPath = path.join(scriptsBase, args[0]);
    if (!fs.existsSync(scriptPath)) { console.error('Script not found:', scriptPath); resolve(null); return; }
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
async function runFaceTimeline(inputPath: string): Promise<{ cmdsPath: string; crop_w: number; crop_h: number; width: number; height: number; avg_cx: number } | null> {
  const cmdsPath = path.join(os.tmpdir(), `face_cmds_${Date.now()}.txt`);
  const raw = await spawnPython(['face_detect_timeline.py', inputPath, cmdsPath], 90000);
  if (!raw) return null;
  try {
    const result = JSON.parse(raw);
    if (result.status === 'ok' && fs.existsSync(cmdsPath) && result.detected > 0) {
      return {
        cmdsPath,
        crop_w: result.crop_w,
        crop_h: result.crop_h,
        width: result.width,
        height: result.height,
        avg_cx: result.avg_cx
      };
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

async function processClipVideo(
  inputPath: string,
  outputPath: string,
  options: {
    format: string;
    videoMode: string;
    useSubtitles: boolean;
    captionStyle: 'normal' | 'tiktok';
    startSec: number;
    info: any;
    userId: number;
    subFontName?: string;
    subFontSize?: number;
    subHighlightColor?: string;
  }
): Promise<{ rawSubPath: string | null; cmdsPath: string | null }> {
  const { format, videoMode, useSubtitles, captionStyle, startSec, info, userId, subFontName, subFontSize, subHighlightColor } = options;

  const settings = db.prepare('SELECT satisfying_video_path FROM settings WHERE user_id = ?').get(userId) as any;
  const satisfyingPath = settings?.satisfying_video_path || '';
  const hasSatisfying = format === 'portrait' && videoMode === 'split' && satisfyingPath && fs.existsSync(satisfyingPath);

  let subInfo: any = null;
  if (useSubtitles) {
    if (captionStyle === 'tiktok') {
      subInfo = await prepareAssSubtitles(info, startSec, {
        fontName: subFontName,
        fontSize: subFontSize ? Number(subFontSize) : undefined,
        highlightColor: subHighlightColor
      });
    } else {
      subInfo = await prepareSubtitles(info, startSec, 'normal');
    }
  }

  let faceTimeline: { cmdsPath: string; crop_w: number; crop_h: number; width: number; height: number; avg_cx: number } | null = null;
  if (format === 'portrait' && (videoMode === 'reframe' || videoMode === 'split')) {
    faceTimeline = await runFaceTimeline(inputPath);
  }

  let job = ffmpeg(inputPath);
  if (hasSatisfying) {
    job = job.input(satisfyingPath);
  }

  const outputOpts = [
    "-c:v libx264",
    "-crf 18",
    "-preset medium",
    "-profile:v high",
    "-level 4.2",
    "-pix_fmt yuv420p",
    "-c:a aac",
    "-b:a 256k",
    "-ar 48000"
  ];
  if (hasSatisfying) {
    outputOpts.push("-shortest");
  }
  job = job.outputOptions(outputOpts);

  if (format === 'portrait') {
    if (videoMode === 'split') {
      let complex = '';
      if (hasSatisfying) {
        complex = `[0:v]crop=ih*9/16:ih,scale=1080:960[top];[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[bottom];[top][bottom]vstack=inputs=2[vid]`;
      } else {
        if (faceTimeline && faceTimeline.avg_cx !== undefined) {
          const cmdsEsc = faceTimeline.cmdsPath.replace(/\\/g, '/').replace(':', '\\:');
          const width = faceTimeline.width;
          const avgCx = faceTimeline.avg_cx;

          // If avgCx > width / 2 (face is on the right):
          // - Top is left half (content)
          // - Bottom is face tracked (right)
          // If avgCx <= width / 2 (face is on the left):
          // - Top is right half (content)
          // - Bottom is face tracked (left)
          const topCropX = avgCx > width / 2 ? 0 : Math.floor(width / 2);
          
          complex = `[0:v]split[top][bottom];` +
                    `[top]crop=iw/2:ih:${topCropX}:0,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[t];` +
                    `[bottom]sendcmd=f='${cmdsEsc}',crop=${faceTimeline.crop_w}:${faceTimeline.crop_h},scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[b];` +
                    `[t][b]vstack=inputs=2[vid]`;
        } else {
          complex = `[0:v]split[top][bottom];` +
                    `[top]crop=iw/2:ih:0:0,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[t];` +
                    `[bottom]crop=iw/2:ih:iw/2:0,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[b];` +
                    `[t][b]vstack=inputs=2[vid]`;
        }
      }

      if (subInfo) {
        const subFilter = captionStyle === 'tiktok'
          ? `subtitles='${subInfo.ffmpegPath}'`
          : `subtitles='${subInfo.ffmpegPath}':force_style='${getSubtitleStyle('normal')}'`;
        complex += `;[vid]${subFilter}[vfinal]`;
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
        filters.push('crop=ih*9/16:ih');
      }
      if (subInfo) {
        if (captionStyle === 'tiktok') {
          filters.push(`subtitles='${subInfo.ffmpegPath}'`);
        } else {
          filters.push(`subtitles='${subInfo.ffmpegPath}':force_style='${getSubtitleStyle('normal')}'`);
        }
      }
      job = job.videoFilters(filters);
    }
  } else {
    if (subInfo) {
      if (captionStyle === 'tiktok') {
        job = job.videoFilters([`subtitles='${subInfo.ffmpegPath}'`]);
      } else {
        job = job.videoFilters([`subtitles='${subInfo.ffmpegPath}':force_style='${getSubtitleStyle('normal')}'`]);
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    job.save(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err));
  });

  return {
    rawSubPath: subInfo ? subInfo.rawPath : null,
    cmdsPath: faceTimeline ? faceTimeline.cmdsPath : null
  };
}

async function uploadToInstagramReels(videoPath: string, caption: string, igAccountId: string, accessToken: string) {
  const formData = new FormData();
  const fileBlob = new Blob([fs.readFileSync(videoPath)]);
  formData.append('file', fileBlob, 'video.mp4');

  const tempRes = await fetch('https://tmpfiles.org/api/v1/upload', {
    method: 'POST',
    body: formData
  });
  if (!tempRes.ok) throw new Error("Gagal mengunggah berkas ke server hosting sementara");
  const tempData = (await tempRes.json()) as any;
  const rawVideoUrl = tempData.data.url.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/');

  const containerRes = await fetch(`https://graph.facebook.com/v19.0/${igAccountId}/media?media_type=REELS&video_url=${encodeURIComponent(rawVideoUrl)}&caption=${encodeURIComponent(caption)}&access_token=${accessToken}`, {
    method: 'POST'
  });
  if (!containerRes.ok) {
    const err = (await containerRes.json()) as any;
    throw new Error("Instagram container init failed: " + (err.error?.message || containerRes.statusText));
  }
  const containerData = (await containerRes.json()) as any;
  const creationId = containerData.id;

  let ready = false;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const statusRes = await fetch(`https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${accessToken}`);
    if (statusRes.ok) {
      const statusData = (await statusRes.json()) as any;
      if (statusData.status_code === 'FINISHED') {
        ready = true;
        break;
      } else if (statusData.status_code === 'ERROR') {
        throw new Error("Instagram processing error");
      }
    }
  }
  if (!ready) throw new Error("Instagram processing timeout");

  const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igAccountId}/media_publish?creation_id=${creationId}&access_token=${accessToken}`, {
    method: 'POST'
  });
  if (!publishRes.ok) {
    const err = (await publishRes.json()) as any;
    throw new Error("Instagram publish failed: " + (err.error?.message || publishRes.statusText));
  }
  const publishData = (await publishRes.json()) as any;
  return publishData.id;
}

async function uploadToTikTok(videoPath: string, title: string, accessToken: string) {
  const stats = fs.statSync(videoPath);
  const videoSize = stats.size;

  const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      post_info: {
        title: title.substring(0, 150),
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false
      },
      source: "FILE_UPLOAD",
      video_size: videoSize
    })
  });

  if (!initRes.ok) {
    const err = (await initRes.json()) as any;
    throw new Error("TikTok init failed: " + (err.error?.message || initRes.statusText));
  }
  const initData = (await initRes.json()) as any;
  const uploadUrl = initData.data.upload_url;
  const publishId = initData.data.publish_id;

  const fileStream = fs.createReadStream(videoPath);
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
      'Content-Type': 'video/mp4'
    },
    body: fileStream as any
  });

  if (!uploadRes.ok) {
    throw new Error("TikTok upload failed: " + uploadRes.statusText);
  }

  return publishId;
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

  const schedulerDir = process.env.APPDATA 
    ? path.join(process.env.APPDATA, 'ViralClipAI', 'scheduler_videos')
    : path.resolve('./scheduler_videos');
  if (!fs.existsSync(schedulerDir)) {
    fs.mkdirSync(schedulerDir, { recursive: true });
  }

  // Background Scheduler Worker
  const runSchedulerWorker = async () => {
    try {
      const jobs = db.prepare("SELECT * FROM scheduler_queue WHERE status = 'pending' AND CAST(scheduled_time AS INTEGER) <= ?").all(Date.now()) as any[];

      for (const job of jobs) {
        db.prepare("UPDATE scheduler_queue SET status = 'processing' WHERE id = ?").run(job.id);
        console.log(`[Scheduler] Processing job ${job.id} for user ${job.user_id} on platform ${job.platform}`);

        try {
          if (!fs.existsSync(job.video_path)) {
            throw new Error("File video tidak ditemukan di disk");
          }

          if (job.platform === 'youtube') {
            const tokenRow = db.prepare('SELECT tokens FROM tokens WHERE user_id = ?').get(job.user_id) as any;
            if (!tokenRow) throw new Error("YouTube tidak terhubung");
            const userOauth = getOAuthClient(job.user_id);
            userOauth.setCredentials(JSON.parse(tokenRow.tokens));

            const youtube = google.youtube({ version: "v3", auth: userOauth });
            const response = await youtube.videos.insert({
              part: ["snippet", "status"],
              requestBody: {
                snippet: { title: job.title.substring(0, 100), description: `${job.description}\n\n#shorts #viralclipai`, tags: job.tags ? JSON.parse(job.tags) : [], categoryId: "22" },
                status: { privacyStatus: "public", selfDeclaredMadeForKids: false }
              },
              media: { body: fs.createReadStream(job.video_path) }
            });
            const videoId = response.data.id!;
            
            try {
              const hook = job.description?.split(' ').slice(0, 5).join(' ') || '';
              const thumbPath = await generateThumbnailPy(job.video_path, job.title, hook);
              if (thumbPath) {
                await youtube.thumbnails.set({
                  videoId,
                  media: { mimeType: 'image/jpeg', body: fs.createReadStream(thumbPath) }
                });
                fs.unlinkSync(thumbPath);
              }
            } catch (thumbErr) {
              console.warn('[Scheduler] Thumbnail skipped:', thumbErr);
            }

            db.prepare("UPDATE scheduler_queue SET status = 'success' WHERE id = ?").run(job.id);
            saveToHistory(job.user_id, { type: 'upload', title: job.title, url: `https://youtube.com/shorts/${videoId}`, videoId, status: 'success' });
            if (fs.existsSync(job.video_path)) fs.unlinkSync(job.video_path);

          } else if (job.platform === 'facebook') {
            const settings = db.prepare('SELECT fb_page_access_token, fb_page_id FROM settings WHERE user_id = ?').get(job.user_id) as any;
            if (!settings || !settings.fb_page_access_token || !settings.fb_page_id) {
              throw new Error("Facebook tidak dikonfigurasi di Pengaturan");
            }

            const formData = new FormData();
            const fileBlob = new Blob([fs.readFileSync(job.video_path)]);
            formData.append('source', fileBlob, 'video.mp4');
            formData.append('title', job.title);
            formData.append('description', `${job.description}\n\n#shorts #viralclipai`);
            formData.append('access_token', settings.fb_page_access_token);

            const fbResponse = await fetch(`https://graph.facebook.com/v19.0/${settings.fb_page_id}/videos`, {
              method: 'POST',
              body: formData
            });
            if (!fbResponse.ok) {
              const fbErr = (await fbResponse.json()) as any;
              throw new Error(fbErr.error?.message || "Gagal mengunggah ke Facebook");
            }
            const fbResult = (await fbResponse.json()) as any;
            const videoId = fbResult.id;

            db.prepare("UPDATE scheduler_queue SET status = 'success' WHERE id = ?").run(job.id);
            saveToHistory(job.user_id, { type: 'upload_facebook', title: job.title, url: `https://facebook.com/${videoId}`, videoId, status: 'success' });
            if (fs.existsSync(job.video_path)) fs.unlinkSync(job.video_path);

          } else if (job.platform === 'instagram') {
            const settings = db.prepare('SELECT fb_page_access_token, ig_business_account_id FROM settings WHERE user_id = ?').get(job.user_id) as any;
            if (!settings || !settings.fb_page_access_token || !settings.ig_business_account_id) {
              throw new Error("Instagram tidak dikonfigurasi di Pengaturan");
            }

            const caption = `${job.title}\n\n${job.description}\n\n#shorts #viralclipai`;
            const videoId = await uploadToInstagramReels(job.video_path, caption, settings.ig_business_account_id, settings.fb_page_access_token);

            db.prepare("UPDATE scheduler_queue SET status = 'success' WHERE id = ?").run(job.id);
            saveToHistory(job.user_id, { type: 'upload_instagram', title: job.title, url: `https://instagram.com/reel/${videoId}`, videoId, status: 'success' });
            if (fs.existsSync(job.video_path)) fs.unlinkSync(job.video_path);

          } else if (job.platform === 'tiktok') {
            const settings = db.prepare('SELECT tiktok_access_token FROM settings WHERE user_id = ?').get(job.user_id) as any;
            if (!settings || !settings.tiktok_access_token) {
              throw new Error("TikTok tidak terhubung di Pengaturan");
            }

            const caption = `${job.title}\n\n${job.description}`;
            const videoId = await uploadToTikTok(job.video_path, caption, settings.tiktok_access_token);

            db.prepare("UPDATE scheduler_queue SET status = 'success' WHERE id = ?").run(job.id);
            saveToHistory(job.user_id, { type: 'upload_tiktok', title: job.title, url: `https://tiktok.com/@share/${videoId}`, videoId, status: 'success' });
            if (fs.existsSync(job.video_path)) fs.unlinkSync(job.video_path);
          }

        } catch (err: any) {
          console.error(`[Scheduler] Job ${job.id} failed:`, err.message);
          db.prepare("UPDATE scheduler_queue SET status = 'failed', error_message = ? WHERE id = ?").run(err.message, job.id);
          saveToHistory(job.user_id, { type: 'upload', title: job.title, status: 'error', error: `Scheduler error: ${err.message}` });
        }
      }
    } catch (workerErr: any) {
      console.error("[Scheduler Worker] Error:", workerErr.message);
    }
  };

  setInterval(runSchedulerWorker, 30 * 1000); // Check every 30 seconds

  ffmpeg.setFfmpegPath(resolvedFfmpegPath);

  let watcherStatus = {
    isChecking: false,
    lastChecked: null as string | null,
    lastAction: "Idle",
    logs: [] as string[],
    paused: false,
    pauseReason: '' as string,
    pauseType: '' as '' | 'ai_quota' | 'youtube_quota'
  };

  const pauseWatcher = (reason: string, type: 'ai_quota' | 'youtube_quota') => {
    watcherStatus.paused = true;
    watcherStatus.pauseReason = reason;
    watcherStatus.pauseType = type;
    watcherStatus.lastAction = `⏸️ PAUSED: ${reason}`;
    console.warn(`[Watcher] PAUSED — ${type}: ${reason}`);
  };

  const resumeWatcher = () => {
    watcherStatus.paused = false;
    watcherStatus.pauseReason = '';
    watcherStatus.pauseType = '';
    watcherStatus.lastAction = 'Resumed by user';
    console.log('[Watcher] Resumed by user.');
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

    const exhaustMsg = `Semua kuota AI habis! Telah mencoba ${groqKeys.length} Groq, ${openAIKeys.length} OpenAI, dan ${geminiKeys.length} Gemini API Key. Silakan tambah saldo, ganti API key di Pengaturan, atau tunggu reset kuota.`;
    // Pause watcher automatically so it doesn't keep burning retries
    pauseWatcher('Semua kuota AI (Groq + OpenAI + Gemini) habis. Ganti atau isi ulang API key di Pengaturan.', 'ai_quota');
    throw new Error(exhaustMsg);
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
    await downloadYoutubeSegment(sourceUrl, sectionStr, tempSegPath);

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
    const subInfo: any = null;

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

  // === UPLOAD A SINGLE CLIP TO FACEBOOK PAGE ===
  async function uploadClipToFacebook(
    sourceUrl: string,
    clip: { title: string; hook: string; description: string; tags: string[]; startTimeSeconds: number; endTimeSeconds: number },
    userId: number,
    fbSettings: { fb_page_access_token: string; fb_page_id: string }
  ) {
    const startSec = clip.startTimeSeconds;
    const endSec = clip.endTimeSeconds;
    const startIso = new Date(startSec * 1000).toISOString().substring(11, 19);
    const endIso = new Date(endSec * 1000).toISOString().substring(11, 19);
    const sectionStr = `*${startIso}-${endIso}`;

    // 1. Download clip segment
    const tempSegPath = path.join(os.tmpdir(), `autopilot_fb_seg_${Date.now()}.mp4`);
    await downloadYoutubeSegment(sourceUrl, sectionStr, tempSegPath);

    // 2. Re-encode portrait (9:16) with face tracking (no subtitles for auto-pilot as requested before)
    const tempOutPath = path.join(os.tmpdir(), `autopilot_fb_out_${Date.now()}.mp4`);
    const faceTimeline = await runFaceTimeline(tempSegPath);
    const cropFilter = faceTimeline
      ? `sendcmd=f='${faceTimeline.cmdsPath.replace(/\\/g, '/').replace(':', '\\:')}',crop=${faceTimeline.crop_w}:${faceTimeline.crop_h}`
      : 'crop=ih*9/16:ih';

    const filters: string[] = [cropFilter];

    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempSegPath)
        .videoFilters(filters)
        .outputOptions([
          '-c:v libx264',
          '-crf 18',
          '-preset medium',
          '-profile:v high',
          '-level 4.2',
          '-pix_fmt yuv420p',
          '-movflags +faststart',
          '-c:a aac',
          '-b:a 256k',
          '-ar 48000'
        ])
        .save(tempOutPath)
        .on('end', () => {
          resolve();
        })
        .on('error', reject);
    });

    if (fs.existsSync(tempSegPath)) fs.unlinkSync(tempSegPath);
    if (faceTimeline && fs.existsSync(faceTimeline.cmdsPath)) fs.unlinkSync(faceTimeline.cmdsPath);

    // 3. Upload to Facebook Page via native FormData
    const formData = new FormData();
    const fileBlob = new Blob([fs.readFileSync(tempOutPath)]);
    formData.append('source', fileBlob, 'video.mp4');
    formData.append('title', clip.title);
    formData.append('description', `${clip.description}\n\n${clip.hook}\n\n#shorts #viralclipai`);
    formData.append('access_token', fbSettings.fb_page_access_token);

    const fbResponse = await fetch(`https://graph.facebook.com/v19.0/${fbSettings.fb_page_id}/videos`, {
      method: 'POST',
      body: formData
    });

    if (!fbResponse.ok) {
      const fbErr = (await fbResponse.json()) as any;
      if (fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath);
      throw new Error(fbErr.error?.message || "Gagal mengunggah ke Facebook");
    }

    const fbResult = (await fbResponse.json()) as any;
    const videoId = fbResult.id;

    if (fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath);
    return videoId;
  }

  const runWatcher = async () => {
    if (watcherStatus.isChecking) return;
    // Skip if watcher is paused due to quota/auth issues
    if (watcherStatus.paused) {
      console.log(`[Watcher] Skipping run — paused (${watcherStatus.pauseType}): ${watcherStatus.pauseReason}`);
      return;
    }
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
              const parentHistoryId = saveToHistory(user.id, { type: 'auto_process', title: videoTitle, url: sourceUrl, status: 'processing' });

              try {
                // 1. Get transcript
                addWatcherLog(`Fetching transcript for: ${videoTitle}`);
                const info = await youtubedl(sourceUrl, {
                  dumpSingleJson: true,
                  noCheckCertificates: true,
                  noWarnings: true,
                  extractorArgs: 'youtube:player_client=android'
                } as any) as any;

                let transcript = await fetchTranscript(info);
                if (!transcript) {
                  addWatcherLog(`No YouTube transcript for ${videoTitle}. Trying fallback audio transcription...`);
                  transcript = await transcribeVideoAudio(sourceUrl, user.id);
                }

                if (!transcript) {
                  addWatcherLog(`No transcript for ${videoTitle}, skipping.`);
                  if (parentHistoryId) {
                    db.prepare("UPDATE history SET status = 'error', details = ? WHERE id = ?").run(JSON.stringify({ error: "No transcript available" }), parentHistoryId);
                  }
                  db.prepare('INSERT OR IGNORE INTO processed_videos (user_id, video_id) VALUES (?, ?)').run(user.id, videoId);
                  continue;
                }

                // 2. AI analyze top 2 clips
                addWatcherLog(`AI analyzing clips for: ${videoTitle}`);
                const clips = await analyzeClipsServer(sourceUrl, videoTitle, transcript, 2, user.id);
                if (!clips || clips.length === 0) {
                  addWatcherLog(`No clips generated for ${videoTitle}.`);
                  if (parentHistoryId) {
                    db.prepare("UPDATE history SET status = 'error', details = ? WHERE id = ?").run(JSON.stringify({ error: "No clips generated by AI" }), parentHistoryId);
                  }
                  db.prepare('INSERT OR IGNORE INTO processed_videos (user_id, video_id) VALUES (?, ?)').run(user.id, videoId);
                  continue;
                }

                // Get Facebook settings for auto-posting if configured
                const fbSettings = db.prepare('SELECT fb_page_access_token, fb_page_id FROM settings WHERE user_id = ?').get(user.id) as any;
                const hasFb = fbSettings && fbSettings.fb_page_access_token && fbSettings.fb_page_id;

                // 3. Upload each clip
                for (const clip of clips) {
                  addWatcherLog(`Uploading clip to YouTube: ${clip.title}`);
                  try {
                    const uploadedId = await uploadClipToYoutube(youtube, sourceUrl, clip, user.id);
                    saveToHistory(user.id, {
                      type: 'auto_process', title: clip.title,
                      url: `https://youtube.com/shorts/${uploadedId}`,
                      details: { videoId: uploadedId, sourceVideo: videoTitle, platform: 'youtube' },
                      status: 'success'
                    });
                    addWatcherLog(`✅ Uploaded Shorts: https://youtube.com/shorts/${uploadedId}`);
                  } catch (clipErr: any) {
                    addWatcherLog(`❌ Failed clip YouTube "${clip.title}": ${clipErr.message}`);
                    saveToHistory(user.id, { type: 'auto_process', title: clip.title, url: sourceUrl, status: 'error', error: clipErr.message });
                  }

                  if (hasFb) {
                    addWatcherLog(`Uploading clip to Facebook: ${clip.title}`);
                    try {
                      const fbUploadedId = await uploadClipToFacebook(sourceUrl, clip, user.id, fbSettings);
                      saveToHistory(user.id, {
                        type: 'auto_process_facebook', title: clip.title,
                        url: `https://facebook.com/${fbUploadedId}`,
                        details: { videoId: fbUploadedId, sourceVideo: videoTitle, platform: 'facebook' },
                        status: 'success'
                      });
                      addWatcherLog(`✅ Uploaded Facebook: https://facebook.com/${fbUploadedId}`);
                    } catch (fbErr: any) {
                      addWatcherLog(`❌ Failed clip FB "${clip.title}": ${fbErr.message}`);
                      saveToHistory(user.id, { type: 'auto_process_facebook', title: clip.title, url: sourceUrl, status: 'error', error: fbErr.message });
                    }
                  }
                }
                
                // Update parent video status to success!
                if (parentHistoryId) {
                  db.prepare("UPDATE history SET status = 'success' WHERE id = ?").run(parentHistoryId);
                }

                // Mark video as processed ONLY after all clips attempted successfully
                db.prepare('INSERT OR IGNORE INTO processed_videos (user_id, video_id) VALUES (?, ?)').run(user.id, videoId);
                addWatcherLog(`✅ Finished processing: ${videoTitle}`);
              } catch (videoErr: any) {
                addWatcherLog(`❌ Error processing ${videoTitle}: ${videoErr.message} — will retry next run`);
                if (parentHistoryId) {
                  db.prepare("UPDATE history SET status = 'error', details = ? WHERE id = ?").run(JSON.stringify({ error: videoErr.message }), parentHistoryId);
                }
              }
            }
          } catch (chanErr: any) {
            const errMsg = chanErr.message || '';
            const isYoutubeQuota = errMsg.includes('quota') || errMsg.includes('quotaExceeded') || chanErr?.code === 403;
            if (isYoutubeQuota) {
              const reason = 'Kuota YouTube API OAuth habis. Tunggu reset harian, atau hubungkan ulang akun YouTube lain di tombol Connect YT.';
              pauseWatcher(reason, 'youtube_quota');
              addWatcherLog(`⏸️ Watcher dijeda: ${reason}`);
            } else {
              addWatcherLog(`Error on channel ${channelId}: ${errMsg}`);
            }
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
    if (watcherStatus.paused) return res.status(400).json({ error: "Watcher is paused. Use /resume to unpause first." });
    runWatcher();
    res.json({ success: true });
  });

  app.post("/api/v2/watcher/resume", authMiddleware, (req: any, res) => {
    resumeWatcher();
    runWatcher();
    res.json({ success: true, message: "Watcher resumed and started a new check." });
  });


  app.get("/api/video-info", authMiddleware, async (req, res) => {
    try {
      const info = await youtubedl(req.query.url as string, { dumpJson: true, noWarnings: true, noCheckCertificates: true, extractorArgs: 'youtube:player_client=android' } as any);
      const data = typeof info === "string" ? JSON.parse(info) : info;
      res.json({ title: data.title, description: data.description, uploader: data.uploader, duration: data.duration });
    } catch (err: any) { 
      console.error("YOUTUBE-DL ERROR:", err);
      res.status(500).json({ error: "Failed to fetch video metadata" }); 
    }
  });

  app.get("/api/transcript", authMiddleware, async (req: any, res) => {
    try {
      const { url } = req.query;
      const info = await youtubedl(url as string, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, extractorArgs: 'youtube:player_client=android' } as any) as any;
      let transcript = await fetchTranscript(info, true);
      if (!transcript) {
        transcript = await transcribeVideoAudio(url as string, req.user.id);
      }
      res.json({ transcript });
    } catch (err: any) {
      console.error("Transcript Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/download-clip", authMiddleware, async (req: any, res) => {
    try {
      const { url, start, end, format, quality, useSubtitles, captionStyle, videoMode, subFontName, subFontSize, subHighlightColor } = req.query;

      const startSec = parseFloat(start as string);
      const endSec = parseFloat(end as string);
      const startIso = new Date(startSec * 1000).toISOString().substring(11, 19);
      const endIso = new Date(endSec * 1000).toISOString().substring(11, 19);
      const sectionStr = `*${startIso}-${endIso}`;

      const info = await youtubedl(url as string, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, extractorArgs: 'youtube:player_client=android' } as any) as any;
      const title = info.title ? info.title.replace(/[^a-zA-Z0-9]/g, "_") : "video";
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", contentDisposition(`clip_${title}.mp4`));

      const tempVideoPath = path.join(os.tmpdir(), `temp_seg_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`);

      await downloadYoutubeSegment(url as string, sectionStr, tempVideoPath);

      const tempOutPath = path.join(os.tmpdir(), `clip_out_${Date.now()}.mp4`);
      const cleanup = await processClipVideo(tempVideoPath, tempOutPath, {
        format: format as string,
        videoMode: videoMode as string,
        useSubtitles: useSubtitles === 'true' || useSubtitles === true,
        captionStyle: captionStyle as 'normal' | 'tiktok',
        startSec,
        info,
        userId: req.user.id,
        subFontName: subFontName as string,
        subFontSize: subFontSize ? Number(subFontSize) : undefined,
        subHighlightColor: subHighlightColor as string
      });

      res.sendFile(tempOutPath, (err) => {
        if (cleanup.rawSubPath && fs.existsSync(cleanup.rawSubPath)) fs.unlinkSync(cleanup.rawSubPath);
        if (cleanup.cmdsPath && fs.existsSync(cleanup.cmdsPath)) fs.unlinkSync(cleanup.cmdsPath);
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath);
        saveToHistory(req.user.id, { type: 'download', title, url, status: err ? 'error' : 'success' });
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });


  app.get("/api/thumbnail/extract", authMiddleware, async (req, res) => {
    try {
      const info = await youtubedl(req.query.url as string, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, extractorArgs: 'youtube:player_client=android' } as any);
      const videoUrl = (info as any).url;
      res.setHeader('Content-Type', 'image/jpeg');
      ffmpeg(videoUrl).setFfmpegPath(resolvedFfmpegPath).seekInput(Number(req.query.time) || 0).frames(1).format('image2').pipe(res, { end: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/upload/youtube", authMiddleware, express.json(), async (req: any, res) => {
    try {
      const { url, start, end, format, title, description, tags, quality, useSubtitles, captionStyle, videoMode, subFontName, subFontSize, subHighlightColor } = req.body;

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
      const tempVideoPath = path.join(os.tmpdir(), `temp_seg_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`);

      await downloadYoutubeSegment(url as string, sectionStr, tempVideoPath);

      const tempPath = path.join(os.tmpdir(), `temp_upload_${Date.now()}.mp4`);
      const cleanup = await processClipVideo(tempVideoPath, tempPath, {
        format: format as string,
        videoMode: videoMode as string,
        useSubtitles: useSubtitles === 'true' || useSubtitles === true,
        captionStyle: captionStyle as 'normal' | 'tiktok',
        startSec,
        info,
        userId: req.user.id,
        subFontName,
        subFontSize: subFontSize ? Number(subFontSize) : undefined,
        subHighlightColor
      });

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
              media: { mimeType: 'image/jpeg', body: fs.createReadStream(thumbPath) }
            });
            fs.unlinkSync(thumbPath);
          }
        } catch (thumbErr) {
          console.warn('Thumbnail upload skipped:', thumbErr);
        }

        if (cleanup.rawSubPath && fs.existsSync(cleanup.rawSubPath)) fs.unlinkSync(cleanup.rawSubPath);
        if (cleanup.cmdsPath && fs.existsSync(cleanup.cmdsPath)) fs.unlinkSync(cleanup.cmdsPath);
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        saveToHistory(req.user.id, { type: 'upload', title, url, videoId, status: 'success' });
        res.json({ success: true, videoId });
      } catch (uploadErr: any) {
        if (cleanup.rawSubPath && fs.existsSync(cleanup.rawSubPath)) fs.unlinkSync(cleanup.rawSubPath);
        if (cleanup.cmdsPath && fs.existsSync(cleanup.cmdsPath)) fs.unlinkSync(cleanup.cmdsPath);
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        saveToHistory(req.user.id, { type: 'upload', title, url, status: 'error' });
        res.status(500).json({ error: uploadErr.message });
      }
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/upload/facebook", authMiddleware, express.json(), async (req: any, res) => {
    try {
      const { url, start, end, format, title, description, quality, useSubtitles, captionStyle, videoMode, subFontName, subFontSize, subHighlightColor } = req.body;

      const settings = db.prepare('SELECT fb_page_access_token, fb_page_id FROM settings WHERE user_id = ?').get(req.user.id) as any;
      if (!settings || !settings.fb_page_access_token || !settings.fb_page_id) {
        return res.status(400).json({ error: "Facebook Page Access Token atau Page ID belum diatur di Pengaturan." });
      }

      const startSec = parseFloat(start as string);
      const endSec = parseFloat(end as string);
      const startIso = new Date(startSec * 1000).toISOString().substring(11, 19);
      const endIso = new Date(endSec * 1000).toISOString().substring(11, 19);
      const sectionStr = `*${startIso}-${endIso}`;

      const info = await youtubedl(url as string, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, extractorArgs: 'youtube:player_client=android' } as any) as any;
      const tempVideoPath = path.join(os.tmpdir(), `temp_seg_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`);

      await downloadYoutubeSegment(url as string, sectionStr, tempVideoPath);

      const tempPath = path.join(os.tmpdir(), `temp_upload_fb_${Date.now()}.mp4`);
      const cleanup = await processClipVideo(tempVideoPath, tempPath, {
        format: format as string,
        videoMode: videoMode as string,
        useSubtitles: useSubtitles === 'true' || useSubtitles === true,
        captionStyle: captionStyle as 'normal' | 'tiktok',
        startSec,
        info,
        userId: req.user.id,
        subFontName,
        subFontSize: subFontSize ? Number(subFontSize) : undefined,
        subHighlightColor
      });

      try {
        const formData = new FormData();
        const fileBlob = new Blob([fs.readFileSync(tempPath)]);
        formData.append('source', fileBlob, 'video.mp4');
        formData.append('title', title);
        formData.append('description', `${description}\n\n#shorts #viralclipai`);
        formData.append('access_token', settings.fb_page_access_token);

        const fbResponse = await fetch(`https://graph.facebook.com/v19.0/${settings.fb_page_id}/videos`, {
          method: 'POST',
          body: formData
        });

        if (!fbResponse.ok) {
          const fbErr = (await fbResponse.json()) as any;
          throw new Error(fbErr.error?.message || "Gagal mengunggah ke Facebook");
        }

        const fbResult = (await fbResponse.json()) as any;
        const videoId = fbResult.id;

        if (cleanup.rawSubPath && fs.existsSync(cleanup.rawSubPath)) fs.unlinkSync(cleanup.rawSubPath);
        if (cleanup.cmdsPath && fs.existsSync(cleanup.cmdsPath)) fs.unlinkSync(cleanup.cmdsPath);
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        saveToHistory(req.user.id, { type: 'upload_facebook', title, url, videoId, status: 'success' });
        res.json({ success: true, videoId });
      } catch (uploadErr: any) {
        if (cleanup.rawSubPath && fs.existsSync(cleanup.rawSubPath)) fs.unlinkSync(cleanup.rawSubPath);
        if (cleanup.cmdsPath && fs.existsSync(cleanup.cmdsPath)) fs.unlinkSync(cleanup.cmdsPath);
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        saveToHistory(req.user.id, { type: 'upload_facebook', title, url, status: 'error', error: uploadErr.message });
        res.status(500).json({ error: uploadErr.message });
      }
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/upload/instagram", authMiddleware, express.json(), async (req: any, res) => {
    try {
      const { url, start, end, format, title, description, quality, useSubtitles, captionStyle, videoMode, subFontName, subFontSize, subHighlightColor } = req.body;
      const settings = db.prepare('SELECT fb_page_access_token, ig_business_account_id FROM settings WHERE user_id = ?').get(req.user.id) as any;
      if (!settings || !settings.fb_page_access_token || !settings.ig_business_account_id) {
        return res.status(400).json({ error: "Instagram Business Account ID atau Meta Access Token belum diatur di Pengaturan." });
      }

      const startSec = parseFloat(start as string);
      const endSec = parseFloat(end as string);
      const startIso = new Date(startSec * 1000).toISOString().substring(11, 19);
      const endIso = new Date(endSec * 1000).toISOString().substring(11, 19);
      const sectionStr = `*${startIso}-${endIso}`;

      const info = await youtubedl(url as string, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, extractorArgs: 'youtube:player_client=android' } as any) as any;
      const tempVideoPath = path.join(os.tmpdir(), `temp_seg_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`);

      await downloadYoutubeSegment(url as string, sectionStr, tempVideoPath);

      const tempPath = path.join(os.tmpdir(), `temp_upload_ig_${Date.now()}.mp4`);
      const cleanup = await processClipVideo(tempVideoPath, tempPath, {
        format: format as string,
        videoMode: videoMode as string,
        useSubtitles: useSubtitles === 'true' || useSubtitles === true,
        captionStyle: captionStyle as 'normal' | 'tiktok',
        startSec,
        info,
        userId: req.user.id,
        subFontName,
        subFontSize: subFontSize ? Number(subFontSize) : undefined,
        subHighlightColor
      });

      try {
        const caption = `${title}\n\n${description}\n\n#shorts #viralclipai`;
        const videoId = await uploadToInstagramReels(tempPath, caption, settings.ig_business_account_id, settings.fb_page_access_token);

        if (cleanup.rawSubPath && fs.existsSync(cleanup.rawSubPath)) fs.unlinkSync(cleanup.rawSubPath);
        if (cleanup.cmdsPath && fs.existsSync(cleanup.cmdsPath)) fs.unlinkSync(cleanup.cmdsPath);
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        saveToHistory(req.user.id, { type: 'upload_instagram', title, url, videoId, status: 'success' });
        res.json({ success: true, videoId });
      } catch (uploadErr: any) {
        if (cleanup.rawSubPath && fs.existsSync(cleanup.rawSubPath)) fs.unlinkSync(cleanup.rawSubPath);
        if (cleanup.cmdsPath && fs.existsSync(cleanup.cmdsPath)) fs.unlinkSync(cleanup.cmdsPath);
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        saveToHistory(req.user.id, { type: 'upload_instagram', title, url, status: 'error', error: uploadErr.message });
        res.status(500).json({ error: uploadErr.message });
      }
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/upload/tiktok", authMiddleware, express.json(), async (req: any, res) => {
    try {
      const { url, start, end, format, title, description, quality, useSubtitles, captionStyle, videoMode, subFontName, subFontSize, subHighlightColor } = req.body;
      const settings = db.prepare('SELECT tiktok_access_token FROM settings WHERE user_id = ?').get(req.user.id) as any;
      if (!settings || !settings.tiktok_access_token) {
        return res.status(400).json({ error: "TikTok Access Token belum diatur di Pengaturan." });
      }

      const startSec = parseFloat(start as string);
      const endSec = parseFloat(end as string);
      const startIso = new Date(startSec * 1000).toISOString().substring(11, 19);
      const endIso = new Date(endSec * 1000).toISOString().substring(11, 19);
      const sectionStr = `*${startIso}-${endIso}`;

      const info = await youtubedl(url as string, { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true, extractorArgs: 'youtube:player_client=android' } as any) as any;
      const tempVideoPath = path.join(os.tmpdir(), `temp_seg_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`);

      await downloadYoutubeSegment(url as string, sectionStr, tempVideoPath);

      const tempPath = path.join(os.tmpdir(), `temp_upload_tt_${Date.now()}.mp4`);
      const cleanup = await processClipVideo(tempVideoPath, tempPath, {
        format: format as string,
        videoMode: videoMode as string,
        useSubtitles: useSubtitles === 'true' || useSubtitles === true,
        captionStyle: captionStyle as 'normal' | 'tiktok',
        startSec,
        info,
        userId: req.user.id,
        subFontName,
        subFontSize: subFontSize ? Number(subFontSize) : undefined,
        subHighlightColor
      });

      try {
        const caption = `${title}\n\n${description}`;
        const videoId = await uploadToTikTok(tempPath, caption, settings.tiktok_access_token);

        if (cleanup.rawSubPath && fs.existsSync(cleanup.rawSubPath)) fs.unlinkSync(cleanup.rawSubPath);
        if (cleanup.cmdsPath && fs.existsSync(cleanup.cmdsPath)) fs.unlinkSync(cleanup.cmdsPath);
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        saveToHistory(req.user.id, { type: 'upload_tiktok', title, url, videoId, status: 'success' });
        res.json({ success: true, videoId });
      } catch (uploadErr: any) {
        if (cleanup.rawSubPath && fs.existsSync(cleanup.rawSubPath)) fs.unlinkSync(cleanup.rawSubPath);
        if (cleanup.cmdsPath && fs.existsSync(cleanup.cmdsPath)) fs.unlinkSync(cleanup.cmdsPath);
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        saveToHistory(req.user.id, { type: 'upload_tiktok', title, url, status: 'error', error: uploadErr.message });
        res.status(500).json({ error: uploadErr.message });
      }
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/scheduler/add", authMiddleware, express.json(), async (req: any, res) => {
    try {
      const { url, start, end, format, title, description, tags, quality, useSubtitles, captionStyle, videoMode, scheduledTime, platform, subFontName, subFontSize, subHighlightColor } = req.body;
      if (!scheduledTime || !platform) {
        return res.status(400).json({ error: "scheduledTime dan platform wajib diisi" });
      }

      const schedulerDir = process.env.APPDATA 
        ? path.join(process.env.APPDATA, 'ViralClipAI', 'scheduler_videos')
        : path.resolve('./scheduler_videos');
      if (!fs.existsSync(schedulerDir)) {
        fs.mkdirSync(schedulerDir, { recursive: true });
      }

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
        ffmpegLocation: resolvedFfmpegPath
      } as any);

      const jobId = Date.now().toString() + Math.random().toString(36).substring(7);
      const finalVideoPath = path.join(schedulerDir, `sched_${jobId}.mp4`);

      const cleanup = await processClipVideo(tempVideoPath, finalVideoPath, {
        format: format as string,
        videoMode: videoMode as string,
        useSubtitles: useSubtitles === 'true' || useSubtitles === true,
        captionStyle: captionStyle as 'normal' | 'tiktok',
        startSec,
        info,
        userId: req.user.id,
        subFontName,
        subFontSize: subFontSize ? Number(subFontSize) : undefined,
        subHighlightColor
      });

      if (cleanup.rawSubPath && fs.existsSync(cleanup.rawSubPath)) fs.unlinkSync(cleanup.rawSubPath);
      if (cleanup.cmdsPath && fs.existsSync(cleanup.cmdsPath)) fs.unlinkSync(cleanup.cmdsPath);
      if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);

      db.prepare(`
        INSERT INTO scheduler_queue (id, user_id, platform, video_path, title, description, tags, scheduled_time, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        jobId,
        req.user.id,
        platform,
        finalVideoPath,
        title,
        description,
        tags ? JSON.stringify(tags) : null,
        scheduledTime.toString()
      );

      res.json({ success: true, jobId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/scheduler/list", authMiddleware, (req: any, res) => {
    try {
      const list = db.prepare("SELECT * FROM scheduler_queue WHERE user_id = ? ORDER BY CAST(scheduled_time AS INTEGER) ASC").all(req.user.id) as any[];
      res.json(list.map(item => ({
        ...item,
        tags: item.tags ? JSON.parse(item.tags) : []
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/scheduler/remove", authMiddleware, express.json(), (req: any, res) => {
    try {
      const { id } = req.body;
      const job = db.prepare("SELECT video_path FROM scheduler_queue WHERE id = ? AND user_id = ?").get(id, req.user.id) as any;
      if (job) {
        if (fs.existsSync(job.video_path)) {
          fs.unlinkSync(job.video_path);
        }
        db.prepare("DELETE FROM scheduler_queue WHERE id = ?").run(id);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Jadwal postingan tidak ditemukan" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });



  // ─────────────────────────────────────────────────────────
  // === ENDPOINT: Analytics Stats ===
  // ─────────────────────────────────────────────────────────
  app.get("/api/stats", authMiddleware, (req: any, res) => {
    try {
      const history = db.prepare('SELECT * FROM history WHERE user_id = ? ORDER BY timestamp DESC').all(req.user.id) as any[];

      const totalUploads     = history.filter(h => h.type?.includes('upload') || h.type?.includes('auto_process')).length;
      const successUploads   = history.filter(h => h.status === 'success').length;
      const failedUploads    = history.filter(h => h.status === 'error' || h.status === 'failed').length;
      const successRate      = totalUploads > 0 ? Math.round((successUploads / totalUploads) * 100) : 0;

      const platformBreakdown: Record<string, number> = { youtube: 0, facebook: 0, instagram: 0, tiktok: 0 };
      history.forEach((h: any) => {
        if (h.type?.includes('youtube') || h.type === 'upload') platformBreakdown.youtube++;
        else if (h.type?.includes('facebook')) platformBreakdown.facebook++;
        else if (h.type?.includes('instagram')) platformBreakdown.instagram++;
        else if (h.type?.includes('tiktok')) platformBreakdown.tiktok++;
      });

      // Last 7 days activity breakdown
      const now = Date.now();
      const dayMs = 86400000;
      const last7days = Array.from({ length: 7 }, (_, i) => {
        const dayStart = now - (6 - i) * dayMs;
        const dayEnd   = dayStart + dayMs;
        const count    = history.filter(h => {
          const t = new Date(h.timestamp).getTime();
          return t >= dayStart && t < dayEnd;
        }).length;
        const label = new Date(dayStart).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' });
        return { label, count, date: new Date(dayStart).toISOString().split('T')[0] };
      });

      const channels = db.prepare('SELECT COUNT(*) as count FROM channels WHERE user_id = ?').get(req.user.id) as any;
      const pendingJobs = db.prepare("SELECT COUNT(*) as count FROM scheduler_queue WHERE user_id = ? AND status = 'pending'").get(req.user.id) as any;

      res.json({
        totalUploads,
        successUploads,
        failedUploads,
        successRate,
        platformBreakdown,
        last7days,
        channelsWatched: channels.count,
        pendingJobs: pendingJobs.count,
        recentActivity: history.slice(0, 10)
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────
  // === ENDPOINT: Re-Analyze clips from URL ===
  // ─────────────────────────────────────────────────────────
  app.post("/api/clips/reanalyze", authMiddleware, express.json(), async (req: any, res) => {
    try {
      const { url, count = 4, focus } = req.body;
      if (!url) return res.status(400).json({ error: "URL wajib diisi" });

      const info = await youtubedl(url as string, {
        dumpSingleJson: true, noCheckCertificates: true,
        noWarnings: true, extractorArgs: 'youtube:player_client=android'
      } as any) as any;

      let transcript = await fetchTranscript(info, true);
      if (!transcript) {
        transcript = await transcribeVideoAudio(url as string, req.user.id);
      }
      if (!transcript) return res.status(422).json({ error: "Tidak dapat mengambil transkrip video" });

      const focusNote = focus ? `\n\nFOKUS KHUSUS: ${focus}` : '';
      const clips = await analyzeClipsServer(url, info.title || '', transcript + focusNote, count, req.user.id);

      res.json({ clips, videoTitle: info.title, duration: info.duration });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────
  // === ENDPOINT: Full Video Metadata ===
  // ─────────────────────────────────────────────────────────
  app.get("/api/video-metadata", authMiddleware, async (req: any, res) => {
    try {
      const { url } = req.query;
      if (!url) return res.status(400).json({ error: "URL wajib diisi" });

      const info = await youtubedl(url as string, {
        dumpSingleJson: true, noCheckCertificates: true,
        noWarnings: true, extractorArgs: 'youtube:player_client=android'
      } as any) as any;

      res.json({
        title: info.title,
        description: info.description,
        uploader: info.uploader,
        uploader_url: info.uploader_url,
        duration: info.duration,
        view_count: info.view_count,
        like_count: info.like_count,
        upload_date: info.upload_date,
        thumbnail: info.thumbnail,
        categories: info.categories,
        tags: info.tags?.slice(0, 20),
        language: info.language,
        chapters: info.chapters,
        automatic_captions_available: !!(info.automatic_captions && Object.keys(info.automatic_captions).length),
        subtitles_available: !!(info.subtitles && Object.keys(info.subtitles).length),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────
  // === ENDPOINT: Clear History ===
  // ─────────────────────────────────────────────────────────
  app.delete("/api/history", authMiddleware, (req: any, res) => {
    try {
      db.prepare('DELETE FROM history WHERE user_id = ?').run(req.user.id);
      res.json({ success: true, message: 'Riwayat aktivitas berhasil dihapus' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────
  // === ENDPOINT: Analyze Clips (server-side, used by frontend) ===
  // ─────────────────────────────────────────────────────────
  app.post("/api/analyze-clips", authMiddleware, express.json(), async (req: any, res) => {
    try {
      const { videoUrl, videoTitle, transcript, count } = req.body;
      if (!videoUrl || !transcript) return res.status(400).json({ error: "videoUrl dan transcript wajib diisi" });
      const clips = await analyzeClipsServer(videoUrl, videoTitle || '', transcript, count || 4, req.user.id);
      res.json({ clips });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // === ENDPOINT: License System ===
  app.get("/api/license/status", async (req, res) => {
    try {
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
      
      const data = (await fetchResponse.json()) as any;
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

      const hwId = machineIdSync();

      const fetchResponse = await fetch('https://rhwebs.com/api/mobile/licenses/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key, hardware_id: hwId })
      });

      const data = (await fetchResponse.json()) as any;
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
      const settings = db.prepare('SELECT gemini_key, openai_key, groq_key, youtube_client_id, youtube_client_secret, fb_page_access_token, fb_page_id, ig_business_account_id, tiktok_access_token, satisfying_video_path FROM settings WHERE user_id = ?').get(req.user.id) || {};
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/settings", authMiddleware, express.json(), (req: any, res) => {
    try {
      const { gemini_key, openai_key, groq_key, youtube_client_id, youtube_client_secret, fb_page_access_token, fb_page_id, ig_business_account_id, tiktok_access_token, satisfying_video_path } = req.body;
      db.prepare(`
        INSERT INTO settings (user_id, gemini_key, openai_key, groq_key, youtube_client_id, youtube_client_secret, fb_page_access_token, fb_page_id, ig_business_account_id, tiktok_access_token, satisfying_video_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
        gemini_key = excluded.gemini_key,
        openai_key = excluded.openai_key,
        groq_key = excluded.groq_key,
        youtube_client_id = excluded.youtube_client_id,
        youtube_client_secret = excluded.youtube_client_secret,
        fb_page_access_token = excluded.fb_page_access_token,
        fb_page_id = excluded.fb_page_id,
        ig_business_account_id = excluded.ig_business_account_id,
        tiktok_access_token = excluded.tiktok_access_token,
        satisfying_video_path = excluded.satisfying_video_path
      `).run(
        req.user.id,
        gemini_key || '',
        openai_key || '',
        groq_key || '',
        youtube_client_id || '',
        youtube_client_secret || '',
        fb_page_access_token || '',
        fb_page_id || '',
        ig_business_account_id || '',
        tiktok_access_token || '',
        satisfying_video_path || ''
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));


  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true, hmr: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, '..', 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}

startServer();
