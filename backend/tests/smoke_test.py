import urllib.request
import sys
import time
import json

BASE_URL = "https://sai.shafeeq.dev/api"

def test_root():
    print("Testing Root Endpoint (SAI Backend)...")
    try:
        req = urllib.request.Request(f"{BASE_URL}/", headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
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

if __name__ == "__main__":
    print("🚀 Starting Smoke Test...")
    success = True
    if not test_root(): success = False
    
    if success:
        print("\n✨ All Smoke Tests Passed!")
        sys.exit(0)
    else:
        print("\n💀 Smoke Tests Failed!")
        sys.exit(1)
