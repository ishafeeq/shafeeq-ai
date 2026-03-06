import json
import logging
import eval_type_backport
eval_type_backport.install()
import os
import os
from custom_aiml_model import CustomAIMLModel
from deepeval.synthesizer import Synthesizer
from deepeval.synthesizer.config import StylingConfig

# Configure basic logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

OUTPUT_FILE = "test_suite.jsonl"
total_queries = 60

def generate_dataset():
    logging.info(f"Generating {total_queries} Golden Dataset queries via DeepEval Synthesizer...")
    
    # 1. Define the 'Styling' so the LLM knows the exact format
    styling_config = StylingConfig(
        task="Generating diverse test cases for an AI application evaluation.",
        input_format="User query in a casual or technical Hinglish/English mix.",
        expected_output_format="A 'expected_criteria' string explaining the logic and a 'type' classification.",
        scenario="Testing a coding and reasoning assistant that understands Hinglish."
    )
    
    # 2. Initialize custom Model Wrapper for generating cases
    # We use our own wrapper around requests.post to avoid depending on python-dotenv or openai SDK
    aiml_model = CustomAIMLModel(
        model_name="gpt-4o-mini",
        api_key="ask-38df2e1825a043c1a541e75da2c3f863"
    )

    # 3. Initialize Synthesizer
    synthesizer = Synthesizer(
        model=aiml_model, 
        styling_config=styling_config
    )

    # 4. Generate goldens from scratch
    # Note: DeepEval handles the complexity/variety internally
    try:
        logging.info("Calling DeepEval to synthesize dataset...")
        goldens = synthesizer.generate_goldens_from_scratch(num_goldens=total_queries)
    except Exception as e:
        logging.error(f"❌ Synthesis failed! DeepEval encountered an error: {e}")
        return

    # 5. Map formatting and Save to JSONL
    formatted_data = [
        {
            "query": g.input,
            "expected_criteria": g.expected_output,
            "type": "complex_reasoning" # DeepEval generates dynamic inputs, mapping generically for now
        } for g in goldens
    ]

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        for item in formatted_data:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')
            
    logging.info(f"✅ Successfully wrote {len(formatted_data)} test cases to {OUTPUT_FILE}")

if __name__ == "__main__":
    generate_dataset()
