// =====================================================================
// geminiService.ts
//
// CATATAN PENTING:
// File ini TIDAK lagi memanggil Gemini / AI provider secara langsung
// dari browser. Semua analisis AI diproses di SERVER lewat endpoint
// POST /api/analyze-clips yang sudah memiliki fallback chain:
//   Groq (Llama 3.3) → Gemini → OpenAI → Error
//
// Ini menghindari:
//  - 429 Rate Limit dari Gemini di browser
//  - API key terekspos di client-side
//  - Tidak bisa pakai Groq/OpenAI dari browser (CORS)
// =====================================================================

export interface ClipMetadata {
  title: string;
  hook: string;
  description: string;
  tags: string[];
  viralScore: number;
  timestamps: string;
  aspectRatio: 'portrait' | 'landscape';
  startTimeSeconds: number;
  endTimeSeconds: number;
  viralAnalysis: string;
}

export async function generateViralClips(
  url: string,
  format: string = 'portrait',
  videoInfo?: { title: string; description: string },
  transcript?: string,
  count: number = 4
): Promise<ClipMetadata[]> {

  const token = localStorage.getItem('token');
  if (!token) throw new Error("Tidak terautentikasi. Silakan login ulang.");

  const response = await fetch('/api/analyze-clips', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      url,
      videoTitle: videoInfo?.title || url,
      transcript: transcript || '',
      count,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(errData.error || `Server error: ${response.status}`);
  }

  const data = await response.json();

  const clips: ClipMetadata[] = (data.clips || []).map((clip: any) => ({
    title: clip.title || '',
    hook: clip.hook || '',
    description: clip.description || '',
    tags: clip.tags || [],
    viralScore: clip.viralScore || 0,
    timestamps: clip.timestamps || `${clip.startTimeSeconds}s - ${clip.endTimeSeconds}s`,
    aspectRatio: (format === 'portrait' ? 'portrait' : 'landscape') as 'portrait' | 'landscape',
    startTimeSeconds: clip.startTimeSeconds || 0,
    endTimeSeconds: clip.endTimeSeconds || 0,
    viralAnalysis: clip.viralAnalysis || '',
  }));

  return clips;
}
