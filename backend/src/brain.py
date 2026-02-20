from langchain_ollama import OllamaLLM
import os
from dotenv import load_dotenv

load_dotenv()

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

def think(prompt: str) -> str:
    """
    Processes the prompt using DeepSeek-R1:7b via Ollama.
    """
    try:
        llm = OllamaLLM(model="deepseek-r1:7b", base_url=OLLAMA_BASE_URL)
        response = llm.invoke(prompt)
        return response
    except Exception as e:
        print(f"Error during thinking process: {e}")
        return "I'm sorry, I couldn't process that."
