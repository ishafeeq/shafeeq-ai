from sarvamai import SarvamAI
import os
from dotenv import load_dotenv

load_dotenv()

SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")

import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _convert_to_wav(audio_path: str) -> str:
    """Convert webm/other formats to wav. Returns path to wav file."""
    if not audio_path.endswith('.webm'):
        return audio_path
    import subprocess
    wav_path = audio_path.replace('.webm', '.wav')
    try:
        subprocess.run(
            ['ffmpeg', '-i', audio_path, '-ar', '16000', '-ac', '1', '-y', wav_path],
            check=True, capture_output=True
        )
        logger.info(f"Converted {audio_path} → {wav_path}")
        return wav_path
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        logger.error(f"FFmpeg conversion failed: {e}")
        return audio_path  # fallback to original


def transcribe(audio_path: str, language_code: str = "hi-IN") -> dict:
    """
    Transcribes audio using Sarvam AI's Saaras v3 model.

    Calls Sarvam twice:
      1. mode="translate"  → English translation (for LangGraph reasoning)
      2. mode="translit"   → Hinglish/Devanagari transliteration (for UI display + query context)

    Returns:
        {
            "translated_text": str,   # English — passed to LangGraph
            "translit_text":   str,   # Hinglish — shown as main text in UI
        }

    language_code: 'hi-IN' for Hindi, 'unknown' to auto-detect
    """
    if not SARVAM_API_KEY:
        logger.error("SARVAM_API_KEY not found in environment variables.")
        raise ValueError("SARVAM_API_KEY not found in environment variables.")

    if not os.path.exists(audio_path):
        logger.error(f"Audio file not found: {audio_path}")
        return {"translated_text": "", "translit_text": ""}

    # Convert format if needed
    audio_path = _convert_to_wav(audio_path)

    client = SarvamAI(api_subscription_key=SARVAM_API_KEY)
    result = {"translated_text": "", "translit_text": ""}

    # ── Call 1: translate mode → English ──────────────────────────────────────
    try:
        logger.info(f"[STT] translate mode: {audio_path}, lang={language_code}")
        response = client.speech_to_text.transcribe(
            file=open(audio_path, "rb"),
            model="saaras:v3",
            mode="translate",
            language_code=language_code,
        )
        translated = response.transcript if hasattr(response, 'transcript') else str(response)
        result["translated_text"] = translated
        logger.info(f"[STT] translated='{translated[:80]}'")
    except Exception as e:
        logger.exception(f"[STT] translate mode failed: {e}")

    # ── Call 2: translit mode → Hinglish/Devanagari ───────────────────────────
    try:
        logger.info(f"[STT] translit mode: {audio_path}, lang=unknown")
        response = client.speech_to_text.transcribe(
            file=open(audio_path, "rb"),
            model="saaras:v3",
            mode="translit",
            language_code="unknown",   # auto-detect for translit
        )
        translit = response.transcript if hasattr(response, 'transcript') else str(response)
        result["translit_text"] = translit
        logger.info(f"[STT] translit='{translit[:80]}'")
    except Exception as e:
        logger.warning(f"[STT] translit mode failed (non-critical): {e}")
        # Fallback: use translated text if translit fails
        result["translit_text"] = result["translated_text"]

    return result
