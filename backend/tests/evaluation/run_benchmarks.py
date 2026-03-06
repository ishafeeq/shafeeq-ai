import json
import os
import requests
import asyncio
from deepeval import evaluate
from deepeval.metrics import AnswerRelevancyMetric, FaithfulnessMetric
from deepeval.test_case import LLMTestCase

# API Configuration
BOL_AI_API_URL = os.getenv("BOL_AI_API_URL", "http://localhost:9101/chat/benchmark")
TEST_SUITE_FILE = "test_suite.jsonl"

def call_bol_ai_endpoint(query: str):
    """
    Simulates sending a text message to the Bol AI backend and returning the text response.
    """
    payload = {
        "text": query,
        "user_id": "benchmark_test_user_01" 
    }
    
    try:
        response = requests.post(BOL_AI_API_URL, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        return data.get("response", "Error: No response key found in JSON")
        
    except Exception as e:
        print(f"Failed to call Bol AI for query: '{query}' -> {e}")
        return "System Timeout or Error"

def run_evaluation():
    print("🚀 Starting Bol AI DeepEval Baseline Benchmark...")
    
    # 1. Load the Golden Dataset
    if not os.path.exists(TEST_SUITE_FILE):
        print(f"❌ Error: {TEST_SUITE_FILE} not found. Please run generate_dataset.py first.")
        return

    test_cases = []
    
    print("⏳ Calling Bol AI endpoint for all queries...")
    with open(TEST_SUITE_FILE, 'r', encoding='utf-8') as f:
        for idx, line in enumerate(f):
            if not line.strip():
                continue
            
            data = json.loads(line)
            query = data.get("query", "")
            expected_output = data.get("expected_criteria", "")
            
            # 2. Call the LIVE Bol AI Application text endpoint
            actual_response = call_bol_ai_endpoint(query)
            
            # 3. Create a DeepEval Test Case
            # Notice we pass 'expected_output' as context to test Answer Relevancy
            test_case = LLMTestCase(
                input=query,
                actual_output=actual_response,
                expected_output=expected_output,
                retrieval_context=[expected_output] # Using criteria as truth ground
            )
            test_cases.append(test_case)
            
            print(f"  [{idx+1}/100] Processed query: {query[:30]}...")

    # 4. Define the Evaluation Metrics
    # AnswerRelevancy: Does it actually answer the question asked?
    answer_relevancy_metric = AnswerRelevancyMetric(threshold=0.7)
    
    print("\n⚖️ Running DeepEval LLM-as-a-judge scorers...")
    # 5. Execute the Evaluation
    # Note: DeepEval uses OPENAI_API_KEY by default for its judge model.
    # If using Groq as the judge, you must explicitly configure DeepEval to use litellm.
    try:
        evaluate(
            test_cases, 
            metrics=[answer_relevancy_metric],
            print_results=True
        )
        print("\n✅ Baseline Benchmark Complete! Check Grafana/Jaeger (localhost:16686) for your Latency/Cost metrics.")
    except Exception as e:
        print(f"\n❌ Evaluation Failed. Ensure OPENAI_API_KEY is set in .env for the judge model. Error: {e}")

if __name__ == "__main__":
    run_evaluation()
