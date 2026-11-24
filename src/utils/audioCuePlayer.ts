import { Language } from '../types/nonoland';
import { resolveAcademyRecordingUrl } from './academyAudioController';
import { resolveArabicLetterNameAudioUrl } from './arabicLetterAudioMap';
import { soundEngine } from './soundEngine';

export function isSafeAudioUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if ((trimmed.startsWith('/assets/') || trimmed.startsWith('/api/')) && !trimmed.startsWith('//')) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface AudioCuePlayResult {
  ok: boolean;
  source: 'url' | 'tts' | 'blocked' | 'error';
  errorMessage?: string;
}

export class ManagedAudioCuePlayer {
  private audio: HTMLAudioElement | null = null;
  private token = 0;

  stop() {
    this.token += 1;
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.currentTime = 0;
        this.audio.removeAttribute('src');
        this.audio.load();
      } catch {
        // ignore headless cleanup errors
      }
      this.audio = null;
    }
  }

  async playUrl(
    rawUrl: string,
    opts?: { slow?: boolean; lang?: Language },
  ): Promise<AudioCuePlayResult> {
    const uiLang = opts?.lang || 'ar';
    if (!isSafeAudioUrl(rawUrl)) {
      return {
        ok: false,
        source: 'error',
        errorMessage:
          uiLang === 'ar'
            ? 'رابط الملف الصوتي غير صالح.'
            : 'Invalid audio file URL.',
      };
    }

    this.stop();
    const myToken = ++this.token;

    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      return {
        ok: false,
        source: 'error',
        errorMessage:
          uiLang === 'ar'
            ? 'تشغيل الصوت غير متاح في هذه البيئة.'
            : 'Audio playback is unavailable in this environment.',
      };
    }

    const url = rawUrl.trim();
    const audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    this.audio = audio;

    const rate = opts?.slow ? 0.8 : 1.0;
    audio.src = url;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;

    try {
      await audio.play();
      if (this.token !== myToken) {
        audio.pause();
        return { ok: false, source: 'url' };
      }
      audio.playbackRate = rate;
      return { ok: true, source: 'url' };
    } catch (err) {
      if (this.token !== myToken) {
        return { ok: false, source: 'url' };
      }
      const errName = err instanceof DOMException ? err.name : (err as { name?: string })?.name;
      if (errName === 'NotAllowedError') {
        return {
          ok: false,
          source: 'blocked',
          errorMessage:
            uiLang === 'ar'
              ? 'اضغط مرة أخرى لتشغيل الصوت على هذا الجهاز.'
              : 'Tap the audio button again to start playback on this device.',
        };
      }
      return {
        ok: false,
        source: 'error',
        errorMessage:
          uiLang === 'ar'
            ? 'تعذر تشغيل الملف الصوتي المرفق على هذا الجهاز.'
            : 'Could not play the attached audio file on this device.',
      };
    }
  }

  async playCueOrSpeak(params: {
    text?: string;
    lang: Language;
    slow?: boolean;
    audioUrl?: string;
    uiLang?: Language;
    fallbackToTtsOnUrlFailure?: boolean;
  }): Promise<AudioCuePlayResult> {
    const uiLang = params.uiLang || params.lang;
    const explicitUrl = params.audioUrl?.trim();

    if (explicitUrl) {
      soundEngine.stopSpeech();
      const res = await this.playUrl(explicitUrl, { slow: params.slow, lang: uiLang });
      if (res.ok || !params.fallbackToTtsOnUrlFailure || !params.text?.trim()) {
        return res;
      }
      soundEngine.speak(params.text, params.lang, { slow: params.slow });
      return { ok: true, source: 'tts' };
    }

    const text = params.text?.trim();
    if (!text) {
      return {
        ok: false,
        source: 'error',
        errorMessage:
          uiLang === 'ar' ? 'لا يوجد محتوى صوتي لهذا العنصر.' : 'No audio cue configured.',
      };
    }

    const arLetterUrl =
      params.lang === 'ar' ? resolveArabicLetterNameAudioUrl(text) : null;
    const recordingUrl =
      arLetterUrl || resolveAcademyRecordingUrl(text, params.lang);

    if (recordingUrl) {
      soundEngine.stopSpeech();
      const res = await this.playUrl(recordingUrl, { slow: params.slow, lang: uiLang });
      if (res.ok) {
        return res;
      }
      // Fall back to local speech engine only if pre-recorded URL could not play in WebView
      soundEngine.speak(text, params.lang, { slow: params.slow });
      return { ok: true, source: 'tts', errorMessage: res.errorMessage };
    }

    this.stop();
    soundEngine.speak(text, params.lang, { slow: params.slow });
    return { ok: true, source: 'tts' };
  }
}
