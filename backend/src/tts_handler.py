import requests
import os
import sounddevice as sd
import soundfile as sf
import io
import re
import logging

logger = logging.getLogger(__name__)

SARVAM_API_KEY = os.environ["SARVAM_API_KEY"]

def sanitize_text(text: str) -> str:
    """
    Removes code blocks and special characters to make text suitable for TTS.
    """
    # Remove markdown code blocks
    text = re.sub(r'```[\s\S]*?```', '', text)
    # Remove inline code
    text = re.sub(r'`[^`]*`', '', text)
    return text.strip()

def generate_audio(text: str, output_path: str = "output.mp3") -> str:
    """
    Generates audio from text using Sarvam AI's Bulbul v3 model (Streaming) and saves it to a file.
    Returns the path to the saved file if successful, else None.
    """
    clean_text = sanitize_text(text)
    if not clean_text:
        logger.info("Skipping TTS: No speakable text found (likely only code).")
        return None

    url = "https://api.sarvam.ai/text-to-speech/stream" 
    
    payload = {
        "text": clean_text,
        "target_language_code": "hi-IN",
        "speaker": "ritu",       # Female Hindi voice (Sarvam Bulbul-v3)
        "gender": "Female",      # Explicitly request female synthesis
        "model": "bulbul:v3",
        "pace": 1.2,
        "speech_sample_rate": 22050,
        "output_audio_codec": "mp3",
        "enable_preprocessing": True
    }
    
    headers = {
        "Content-Type": "application/json",
        "api-subscription-key": SARVAM_API_KEY
    }

    try:
        # Ensure output file has correct extension
        if payload.get("output_audio_codec") == "mp3" and not output_path.endswith(".mp3"):
           output_path = output_path.replace(".wav", ".mp3")
           
        with requests.post(url, json=payload, headers=headers, stream=True) as response:
            response.raise_for_status()
            
            with open(output_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
        return output_path

    except requests.exceptions.RequestException as e:
        logger.error(f"Error during TTS request: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error during TTS: {e}")
        return None

def speak(text: str, output_path: str = "output.mp3") -> None:
    """
    Generates and plays audio.
    """
    audio_file = generate_audio(text, output_path)
    if not audio_file:
        return

    # Play audio
    try:
         if os.uname().sysname == 'Darwin' and audio_file.endswith(".mp3"):
             os.system(f"afplay {audio_file}")
         else:
            data, fs = sf.read(audio_file)
            sd.play(data, fs)
            sd.wait()
    except Exception as e:
        logger.error(f"Error playing audio: {e}")
        if os.uname().sysname == 'Darwin' and not audio_file.endswith(".mp3"):
             os.system(f"afplay {audio_file}")
