/**
 * ElevenLabsTTSService.js
 * High-quality AI Text-to-Speech via ElevenLabs API.
 * Free tier: ~10,000 characters/month with natural-sounding voices.
 *
 * Usage:
 *   await ElevenLabsTTSService.speak('Olá mundo');
 *   ElevenLabsTTSService.stop();
 */

const STORAGE_KEY = 'ah_elevenlabs';

// Default voice: "Rachel" (multilingual, works well with Portuguese)
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const API_BASE = 'https://api.elevenlabs.io/v1';

let _audio = null;
let _config = null;

export const ElevenLabsTTSService = {

  /**
   * Load saved configuration from storage.
   * @returns {Promise<{apiKey: string, voiceId: string, enabled: boolean}>}
   */
  async getConfig() {
    if (_config) return _config;
    return new Promise(resolve => {
      chrome.storage.sync.get([STORAGE_KEY], d => {
        _config = d[STORAGE_KEY] || { apiKey: '', voiceId: DEFAULT_VOICE_ID, enabled: false };
        resolve(_config);
      });
    });
  },

  /**
   * Save configuration.
   */
  async saveConfig(config) {
    _config = { ...(_config || {}), ...config };
    return new Promise(resolve => {
      chrome.storage.sync.set({ [STORAGE_KEY]: _config }, resolve);
    });
  },

  /**
   * Check if ElevenLabs TTS is configured and enabled.
   */
  async isAvailable() {
    const cfg = await this.getConfig();
    return !!(cfg.enabled && cfg.apiKey);
  },

  /**
   * Speak text using ElevenLabs API.
   * Returns true if successful, false if not available (caller should fallback).
   * @param {string} text
   * @param {object} [options]
   * @param {number} [options.stability=0.5]
   * @param {number} [options.similarity_boost=0.75]
   * @returns {Promise<boolean>}
   */
  async speak(text, options = {}) {
    const cfg = await this.getConfig();
    if (!cfg.enabled || !cfg.apiKey) return false;

    this.stop();

    const voiceId = cfg.voiceId || DEFAULT_VOICE_ID;
    const url = `${API_BASE}/text-to-speech/${voiceId}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': cfg.apiKey
        },
        body: JSON.stringify({
          text: text.slice(0, 5000), // ElevenLabs limit per request
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: options.stability ?? 0.5,
            similarity_boost: options.similarity_boost ?? 0.75
          }
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn('[ElevenLabs] API error:', res.status, err);
        if (res.status === 401) {
          throw new Error('API key inválida. Verifique nas configurações.');
        }
        if (res.status === 429) {
          throw new Error('Limite de caracteres atingido no plano gratuito.');
        }
        return false;
      }

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);

      _audio = new Audio(audioUrl);
      _audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        _audio = null;
      };

      await _audio.play();
      return true;
    } catch (err) {
      console.error('[ElevenLabs] TTS failed:', err);
      throw err;
    }
  },

  /**
   * Stop current playback.
   */
  stop() {
    if (_audio) {
      _audio.pause();
      _audio.currentTime = 0;
      _audio = null;
    }
  },

  /**
   * Check if currently playing.
   */
  isPlaying() {
    return _audio && !_audio.paused;
  },

  /**
   * Fetch available voices from ElevenLabs.
   * @returns {Promise<Array<{voice_id: string, name: string, labels: object}>>}
   */
  async getVoices() {
    const cfg = await this.getConfig();
    if (!cfg.apiKey) return [];

    try {
      const res = await fetch(`${API_BASE}/voices`, {
        headers: { 'xi-api-key': cfg.apiKey }
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.voices || []).map(v => ({
        voice_id: v.voice_id,
        name: v.name,
        labels: v.labels || {}
      }));
    } catch {
      return [];
    }
  },

  /**
   * Get remaining character quota.
   * @returns {Promise<{used: number, limit: number, remaining: number}|null>}
   */
  async getUsage() {
    const cfg = await this.getConfig();
    if (!cfg.apiKey) return null;

    try {
      const res = await fetch(`${API_BASE}/user/subscription`, {
        headers: { 'xi-api-key': cfg.apiKey }
      });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        used: data.character_count || 0,
        limit: data.character_limit || 0,
        remaining: (data.character_limit || 0) - (data.character_count || 0)
      };
    } catch {
      return null;
    }
  }
};
