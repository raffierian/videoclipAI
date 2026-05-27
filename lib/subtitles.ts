import fs from 'fs';
import path from 'path';
import os from 'os';

const EMOJI_MAP: { [key: string]: string } = {
  // Bahasa Indonesia
  uang: '💰', duit: '💰', kaya: '💰', bisnis: '💰', dollar: '💵', emas: '🪙',
  sukses: '🚀', roket: '🚀', terbang: '🚀',
  sedih: '😢', menangis: '😭', nangis: '😭',
  marah: '😡', emosi: '🤬', kesal: '😠',
  kaget: '😱', shock: '😱', terkejut: '😲', wow: '😮',
  lucu: '😂', kocak: '🤣', ketawa: '😆', ngakak: '😄',
  api: '🔥', panas: '🔥', viral: '🔥',
  ide: '💡', pikir: '🧠', otak: '🧠',
  cinta: '❤️', hati: '💖', suka: '😍',
  stop: '🚫', jangan: '🚫', bahaya: '⚠️', awas: '⚠️',
  rahasia: '🤫', diam: '🤫',
  waktu: '⏰', jam: '⏳', cepat: '⚡', kilat: '⚡',
  dunia: '🌍', bumi: '🌏', negara: '🗺️',
  makanan: '🍔', makan: '🍽️', enak: '😋',
  tidur: '😴', mimpi: '😴',
  hebat: '🏆', juara: '👑', raja: '👑',
  
  // English
  money: '💰', cash: '💰', rich: '💰', gold: '🪙',
  success: '🚀', rocket: '🚀', fly: '🚀',
  sad: '😢', cry: '😭',
  angry: '😡', mad: '🤬',
  surprised: '😲',
  funny: '😂', laugh: '😆',
  fire: '🔥', hot: '🔥',
  idea: '💡', brain: '🧠',
  love: '❤️', heart: '💖', like: '😍',
  danger: '⚠️',
  secret: '🤫',
  time: '⏰', clock: '⏳', fast: '⚡',
  food: '🍔', eat: '🍽️', tasty: '😋',
  sleep: '😴', dream: '😴',
  great: '🏆', king: '👑',
};

function getWordEmoji(word: string): string {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  return EMOJI_MAP[clean] || '';
}

function parseSrtTime(t: string): number {
  const parts = t.replace(',', '.').split(':');
  if (parts.length === 3) {
    return (parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])) * 1000;
  }
  return 0;
}

function msToAssTime(ms: number): string {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

export function convertSrtToTikTokAss(
  rawSRT: string, 
  offsetSeconds: number,
  options?: { fontName?: string; fontSize?: number; highlightColor?: string }
): string {
  const lines = rawSRT.split('\n');
  let events = '';
  let i = 0;

  const bgrColors: Record<string, string> = {
    yellow: '00FFFF',
    green: '00FF00',
    cyan: 'FFFF00',
    orange: '00A5FF',
    pink: 'FF00FF',
    red: '0000FF',
    white: 'FFFFFF',
  };

  const hlColorBGR = (options?.highlightColor && bgrColors[options.highlightColor.toLowerCase()]) || '00FFFF';
  const fontName = options?.fontName || 'Impact';
  const fontSize = options?.fontSize || 48;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (/^\d+$/.test(line)) {
      i++;
      const timeLine = (lines[i] || '').trim();
      i++;
      let textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim());
        i++;
      }
      i++;

      const text = textLines.join(' ').replace(/<[^>]+>/g, '').trim();
      if (!text || !timeLine.includes('-->')) continue;

      const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
      let startMs = parseSrtTime(startStr) - (offsetSeconds * 1000);
      let endMs = parseSrtTime(endStr) - (offsetSeconds * 1000);
      if (startMs < 0) startMs = 0;
      if (endMs < 0) endMs = 0;

      const durationMs = endMs - startMs;
      if (durationMs <= 0) continue;

      // Split into words and add emojis
      const rawWords = text.split(/\s+/).filter(w => w.length > 0);
      if (rawWords.length === 0) continue;

      const processedWords = rawWords.map(w => {
        // Capitalize for punchiness
        let formatted = w.toUpperCase();
        const emoji = getWordEmoji(w);
        if (emoji) {
          formatted += ` ${emoji}`;
        }
        return formatted;
      });

      // Calculate time per word
      const wordCount = processedWords.length;
      const msPerWord = durationMs / wordCount;

      for (let w = 0; w < wordCount; w++) {
        const wordStartMs = startMs + (w * msPerWord);
        const wordEndMs = Math.min(wordStartMs + msPerWord, endMs);

        const assStart = msToAssTime(wordStartMs);
        const assEnd = msToAssTime(wordEndMs);

        // Build text where the current word is colored dynamically, others are white (\c&HFFFFFF&)
        const assText = processedWords.map((word, idx) => {
          if (idx === w) {
            return `{\\c&H${hlColorBGR}&}${word}{\\c&HFFFFFF&}`;
          }
          return word;
        }).join(' ');

        events += `Dialogue: 0,${assStart},${assEnd},TikTok,,0,0,0,,${assText}\n`;
      }
    } else {
      i++;
    }
  }

  // Complete ASS structure
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTok,${fontName},${fontSize},&H00FFFFFF,&H00${hlColorBGR}&,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,10,10,320,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  return header + events;
}

export async function prepareAssSubtitles(
  info: any, 
  offsetSeconds: number,
  options?: { fontName?: string; fontSize?: number; highlightColor?: string }
): Promise<{ rawPath: string; ffmpegPath: string } | null> {
  let subUrl = null;
  const langs = ['id', 'en'];

  for (const source of [info.subtitles, info.automatic_captions]) {
    if (!source) continue;
    for (const lang of langs) {
      if (source[lang]) {
        const track = source[lang].find((s: any) => s.ext === 'srt' || s.ext === 'vtt');
        if (track) {
          subUrl = track.url;
          break;
        }
      }
    }
    if (subUrl) break;
  }

  if (!subUrl) return null;

  try {
    const subRes = await fetch(subUrl);
    const subText = await subRes.text();
    const assContent = convertSrtToTikTokAss(subText, offsetSeconds, options);

    const rawPath = path.join(os.tmpdir(), `temp_sub_${Date.now()}_${Math.floor(Math.random() * 1000)}.ass`);
    fs.writeFileSync(rawPath, assContent);

    // Escape path for windows FFmpeg subtitle filter: C:\path -> C\\:/path
    const ffmpegPath = rawPath.replace(/\\/g, '/').replace(':', '\\:');
    return { rawPath, ffmpegPath };
  } catch (e) {
    console.error('[ASS Subtitles] Error generating ASS:', e);
    return null;
  }
}
