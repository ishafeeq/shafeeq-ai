import urllib.request
import sys
import time
import json

BASE_URL = "http://localhost:9101"

def test_root():
    print("Testing Root Endpoint (SAI Backend)...")
    try:
        with urllib.request.urlopen(f"{BASE_URL}/", timeout=10) as response:
            if response.status == 200:
                data = json.loads(response.read().decode())
                print(f"✅ Root Endpoint Passed! Response: {data}")
                return True
            else:
                print(f"❌ Root Endpoint Failed: {response.status}")
                return False
    except Exception as e:
        print(f"❌ Root Error: {e}")
        return False

def test_litellm():
    print("Testing LiteLLM UI Endpoint...")
    try:
        # LiteLLM UI is on port 4000
        with urllib.request.urlopen("http://localhost:4000/ui/", timeout=10) as response:
            if response.status == 200:
                print("✅ LiteLLM UI is accessible!")
                return True
            else:
                print(f"❌ LiteLLM UI Failed: {response.status}")
                return False
    except Exception as e:
        print(f"❌ LiteLLM Error: {e}")
        return False

if __name__ == "__main__":
    print("🚀 Starting Smoke Test...")
    success = True
    if not test_root(): success = False
    if not test_litellm(): success = False
    
    if success:
        print("\n✨ All Smoke Tests Passed!")
        sys.exit(0)
    else:
        print("\n💀 Smoke Tests Failed!")
        sys.exit(1)
