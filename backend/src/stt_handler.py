import logging
import os
from sarvamai import SarvamAI

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SARVAM_API_KEY = os.environ["SARVAM_API_KEY"]


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
    if not os.path.exists(audio_path):
        logger.error(f"Audio file not found: {audio_path}")
        return {"translated_text": "", "translit_text": ""}

    # Main application logic validates the API Key at startup
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
