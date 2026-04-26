import requests

BASE = "http://localhost:8000"

# Check if endpoints exist
resp = requests.post(f"{BASE}/api/sessions/create", json={"name":"Debug","gm_password":"gm123"})
data = resp.json()
session_code = data["session_code"]

# Test create map endpoint
resp2 = requests.post(f"{BASE}/api/map-builder/{session_code}/maps", json={"name":"Test Map"})
print(f"Create map: {resp2.status_code}")
print(f"Response: {resp2.text[:200]}")

# Test list maps
resp3 = requests.get(f"{BASE}/api/map-builder/{session_code}/maps")
print(f"List maps: {resp3.status_code}")
print(f"Response: {resp3.text[:200]}")

# Cleanup
requests.delete(f"{BASE}/api/sessions/{data['session_id']}")
