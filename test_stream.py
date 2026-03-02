import requests
import json
import sseclient

def test_streaming():
    print("Logging in...")
    login_res = requests.post(
        "http://localhost:9101/auth/login",
        data={"username": "shafeeq@example.com", "password": "password"}
    )
    if not login_res.ok:
        print(f"Login failed: {login_res.text}")
        return
        
    token = login_res.json()["access_token"]
    print("Starting stream...")
    
    response = requests.post(
        "http://localhost:9101/chat/text",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"conversation_id": 1, "content": "Tell me a short story about an ocean.", "generate_audio": False},
        stream=True
    )
    
    client = sseclient.SSEClient(response)
    for event in client.events():
        print(f"Event: {event.data}")

if __name__ == "__main__":
    test_streaming()
