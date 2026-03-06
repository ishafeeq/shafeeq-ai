import requests
from typing import List, Optional, Tuple, Any
from deepeval.models.base_model import DeepEvalBaseLLM

class CustomAIMLModel(DeepEvalBaseLLM):
    """
    Custom LLM Wrapper that exclusively uses the AIML API via the `requests` library.
    This prevents tying the codebase to the `openai` Python SDK or requiring `dotenv`.
    DeepEval's Synthesizer will use this to generate AI dataset queries.
    """
    def __init__(
        self,
        model_name: str = "gpt-4o-mini",
        api_key: str = "ask-38df2e1825a043c1a541e75da2c3f863",
        base_url: str = "https://api.aimlapi.com/v1/chat/completions"
    ):
        self._model_name = model_name
        self.api_key = api_key
        self.base_url = base_url

    def load_model(self) -> Any:
        return self

    def generate(self, prompt: str) -> str:
        res = self._call_api([{"role": "user", "content": prompt}])
        return res

    async def a_generate(self, prompt: str) -> str:
        # DeepEval Synthesizer typically uses synchronous generation,
        # but the abstract class requires async implementation signatures.
        # We wrap standard generate for API compatibility.
        return self.generate(prompt)

    def generate_detailed(self, prompt: str) -> Tuple[str, float]:
        """
        Calculates and returns a mock execution cost (e.g. $0.00). 
        Actual API billing is handled server-side at AIML.
        """
        res = self.generate(prompt)
        return res, 0.0

    def get_model_name(self) -> str:
        return self._model_name

    def _call_api(self, messages: List[dict]) -> str:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": self._model_name,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 4000 
        }

        response = requests.post(self.base_url, headers=headers, json=payload, timeout=90)
        
        # Log failure reason explicitly instead of cryptic StackTraces
        if response.status_code != 200:
            raise Exception(f"AIML API Call Failed [{response.status_code}]: {response.text}")
            
        response.raise_for_status()
        
        try:
            return response.json()["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            raise Exception(f"Unexpected response format from AIML API: {response.text}") from e
