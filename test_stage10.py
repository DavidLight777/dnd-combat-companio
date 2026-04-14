"""Stage 10 — Announcements, Notes, Timer, AI NPC gen tests."""
import requests, time

BASE = "http://127.0.0.1:8000"
passed = 0
total = 0

def check(label, condition):
    global passed, total
    total += 1
    if condition:
        passed += 1
        print(f"  \u2705 {label}")
    else:
        print(f"  \u274c {label}")

# ── Setup ──
print("── Setup ──")
r = requests.post(f"{BASE}/api/sessions/create", json={"name": "Stage10 Test"})
check("Session created", r.status_code == 200)
data = r.json()
SESSION_CODE = data["session_code"]
GM_TOKEN = data["gm_token"]
SESSION_ID = data["session_id"]

r = requests.post(f"{BASE}/api/sessions/join", json={"session_code": SESSION_CODE, "player_name": "TestPlayer10"})
check("Player joined", r.status_code == 200)
CHAR_ID = r.json()["character_id"]

# ── Announcements ──
print("\n── Announcements ──")
r = requests.post(f"{BASE}/api/announcements/{SESSION_CODE}", json={"content": "Welcome!", "is_pinned": True})
check("Post announcement 200", r.status_code == 200)
ann = r.json()
ANN_ID = ann["id"]
check("Announcement has id", "id" in ann)
check("Content matches", ann["content"] == "Welcome!")
check("Is pinned", ann["is_pinned"] is True)

r = requests.post(f"{BASE}/api/announcements/{SESSION_CODE}", json={"content": "Normal post"})
check("Post second 200", r.status_code == 200)
ANN_ID2 = r.json()["id"]

r = requests.get(f"{BASE}/api/announcements/{SESSION_CODE}")
check("List announcements 200", r.status_code == 200)
anns = r.json()
check("Has 2 announcements", len(anns) == 2)
check("Pinned first", anns[0]["is_pinned"] is True)

r = requests.patch(f"{BASE}/api/announcements/{ANN_ID}/pin", json={"is_pinned": False})
check("Unpin 200", r.status_code == 200)
check("Now unpinned", r.json()["is_pinned"] is False)

r = requests.delete(f"{BASE}/api/announcements/{ANN_ID2}")
check("Delete announcement 200", r.status_code == 200)

r = requests.get(f"{BASE}/api/announcements/{SESSION_CODE}")
check("After delete: 1 left", len(r.json()) == 1)

# ── Character Notes ──
print("\n── Character Notes ──")
r = requests.post(f"{BASE}/api/notes/character/{CHAR_ID}", json={"title": "My Note", "content": "Secret stuff"})
check("Create player note 200", r.status_code == 200)
note = r.json()
NOTE_ID = note["id"]
check("Note has id", "id" in note)
check("Note title", note["title"] == "My Note")
check("Not GM note", note["is_gm_note"] is False)

r = requests.post(f"{BASE}/api/notes/character/{CHAR_ID}", json={"title": "GM Secret", "content": "Hidden", "is_gm_note": True})
check("Create GM note 200", r.status_code == 200)
GM_NOTE_ID = r.json()["id"]
check("Is GM note", r.json()["is_gm_note"] is True)

# Player endpoint: only non-GM notes
r = requests.get(f"{BASE}/api/notes/character/{CHAR_ID}")
check("Player notes list 200", r.status_code == 200)
check("Player sees 1 note", len(r.json()) == 1)

# GM endpoint: all notes
r = requests.get(f"{BASE}/api/notes/character/{CHAR_ID}/all")
check("GM all notes 200", r.status_code == 200)
check("GM sees 2 notes", len(r.json()) == 2)

# Update note
r = requests.put(f"{BASE}/api/notes/{NOTE_ID}", json={"title": "Updated Title", "content": "New content"})
check("Update note 200", r.status_code == 200)
check("Title updated", r.json()["title"] == "Updated Title")

# Delete note
r = requests.delete(f"{BASE}/api/notes/{GM_NOTE_ID}")
check("Delete GM note 200", r.status_code == 200)

r = requests.get(f"{BASE}/api/notes/character/{CHAR_ID}/all")
check("After delete: 1 left", len(r.json()) == 1)

# ── Session Timer ──
print("\n── Session Timer ──")
r = requests.get(f"{BASE}/api/sessions/{SESSION_CODE}/timer")
check("Get timer 200", r.status_code == 200)
check("Not running initially", r.json()["running"] is False)
check("Total 0", r.json()["total_seconds"] == 0)

r = requests.post(f"{BASE}/api/sessions/{SESSION_CODE}/timer/start")
check("Start timer 200", r.status_code == 200)
check("Running", r.json()["running"] is True)

time.sleep(2)

r = requests.post(f"{BASE}/api/sessions/{SESSION_CODE}/timer/pause")
check("Pause timer 200", r.status_code == 200)
check("Not running", r.json()["running"] is False)
check("Accumulated >= 1s", r.json()["total_seconds"] >= 1)

r = requests.post(f"{BASE}/api/sessions/{SESSION_CODE}/timer/start")
check("Restart timer 200", r.status_code == 200)

time.sleep(1)

r = requests.get(f"{BASE}/api/sessions/{SESSION_CODE}/timer")
check("Get timer running", r.json()["running"] is True)
check("Total growing", r.json()["total_seconds"] >= 2)

r = requests.post(f"{BASE}/api/sessions/{SESSION_CODE}/timer/pause")
check("Final pause", r.status_code == 200)

# ── AI NPC Generation (endpoint exists) ──
print("\n── AI NPC Generation ──")
r = requests.post(f"{BASE}/api/ai/generate-npc", json={})
check("Empty desc → 400", r.status_code == 400)

r = requests.post(f"{BASE}/api/ai/generate-npc", json={"description": "Test NPC"})
# Will fail with 500 if no API key — that's expected
check("Generate NPC endpoint exists", r.status_code in (200, 500, 502, 504))

# ── Edge Cases ──
print("\n── Edge Cases ──")
r = requests.post(f"{BASE}/api/announcements/INVALID", json={"content": "test"})
check("Announcement invalid session 404", r.status_code == 404)

r = requests.delete(f"{BASE}/api/announcements/99999")
check("Delete nonexistent announcement 404", r.status_code == 404)

r = requests.delete(f"{BASE}/api/notes/99999")
check("Delete nonexistent note 404", r.status_code == 404)

r = requests.get(f"{BASE}/api/sessions/INVALID/timer")
check("Timer invalid session 404", r.status_code == 404)

# ── Cleanup ──
print("\n── Cleanup ──")
r = requests.delete(f"{BASE}/api/announcements/{ANN_ID}")
check("Cleanup announcement", r.status_code == 200)
r = requests.delete(f"{BASE}/api/notes/{NOTE_ID}")
check("Cleanup note", r.status_code == 200)

print(f"\n{'='*40}")
print(f"Results: {passed}/{total} passed")
print(f"{'='*40}")
