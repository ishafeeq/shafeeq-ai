import requests
import os
import sounddevice as sd
import soundfile as sf
import io
from dotenv import load_dotenv

load_dotenv()

SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")

import re

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
    if not SARVAM_API_KEY:
        raise ValueError("SARVAM_API_KEY not found in environment variables.")

    clean_text = sanitize_text(text)
    if not clean_text:
        print("Skipping TTS: No speakable text found (likely only code).")
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
        print(f"Error during TTS request: {e}")
        return None
    except Exception as e:
        print(f"Unexpected error during TTS: {e}")
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
        print(f"Error playing audio: {e}")
        if os.uname().sysname == 'Darwin' and not audio_file.endswith(".mp3"):
             os.system(f"afplay {audio_file}")
