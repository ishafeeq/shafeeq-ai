import logging
import os
from sarvamai import SarvamAI

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SARVAM_API_KEY = os.environ["SARVAM_API_KEY"]


def transcribe_en(audio_path: str, language_code: str = "hi-IN") -> str:
    """
    Transcribes audio using Sarvam AI's Saaras v3 model in translate mode.
    Returns English text.
    """
    if not os.path.exists(audio_path):
        logger.error(f"Audio file not found: {audio_path}")
        return ""

    client = SarvamAI(api_subscription_key=SARVAM_API_KEY)
    
    try:
        logger.info(f"[STT] translate mode: {audio_path}, lang={language_code}")
        response = client.speech_to_text.transcribe(
            file=open(audio_path, "rb"),
            model="saaras:v3",
            mode="translate",
            language_code=language_code,
        )
        translated = response.transcript if hasattr(response, 'transcript') else str(response)
        logger.info(f"[STT] translated='{translated[:80]}'")
        return translated
    except Exception as e:
        logger.exception(f"[STT] translate mode failed: {e}")
        return ""

def transliterate_hi(audio_path: str) -> str:
    """
    Transcribes audio using Sarvam AI's Saaras v3 model in translit mode.
    Returns Hinglish text.
    """
    if not os.path.exists(audio_path):
        logger.error(f"Audio file not found: {audio_path}")
        return ""

    client = SarvamAI(api_subscription_key=SARVAM_API_KEY)
    
    try:
        logger.info(f"[STT] translit mode: {audio_path}, lang=unknown")
        response = client.speech_to_text.transcribe(
            file=open(audio_path, "rb"),
            model="saaras:v3",
            mode="translit",
            language_code="unknown",   # auto-detect for translit
        )
        translit = response.transcript if hasattr(response, 'transcript') else str(response)
        logger.info(f"[STT] translit='{translit[:80]}'")
        return translit
    except Exception as e:
        logger.warning(f"[STT] translit mode failed (non-critical): {e}")
        return ""
