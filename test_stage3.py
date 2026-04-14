"""Stage 3 — Economy & Trading end-to-end tests."""
import requests

BASE = "http://localhost:8000"
CHAR_ID = 3   # player
NPC_ID = 4    # NPC

passed = 0
total = 0

def check(name, ok, detail=""):
    global passed, total
    total += 1
    status = "\u2705" if ok else "\u274c"
    print(f"  {status} {name}" + (f" \u2014 {detail}" if detail else ""))
    if ok:
        passed += 1

print("=" * 60)
print("STAGE 3 \u2014 Economy & Trading Tests")
print("=" * 60)

# ── Currency endpoints ──
print("\n\u2500\u2500 Currency \u2500\u2500")

# Give gold
r = requests.post(f"{BASE}/api/characters/{CHAR_ID}/give-gold",
                  json={"gold": 50, "silver": 25, "copper": 10})
d = r.json()
check("Give 50G 25S 10C", r.status_code == 200 and d.get("ok"), f"total={d.get('total_copper')}")

# Get currency
r = requests.get(f"{BASE}/api/characters/{CHAR_ID}/currency")
d = r.json()
check("GET currency", r.status_code == 200 and "currency" in d, f"c={d.get('currency')}")
check("Has rates", "rates" in d, str(d.get("rates")))

# Give gold to NPC too
requests.post(f"{BASE}/api/characters/{NPC_ID}/give-gold", json={"gold": 100})

# Transfer
r = requests.post(f"{BASE}/api/currency/transfer",
                  json={"from_id": CHAR_ID, "to_id": NPC_ID, "copper_amount": 500, "note": "test"})
d = r.json()
check("Transfer 500cp", r.status_code == 200 and d.get("ok"))

# Insufficient funds
r = requests.post(f"{BASE}/api/currency/transfer",
                  json={"from_id": CHAR_ID, "to_id": NPC_ID, "copper_amount": 999999999})
check("Insufficient funds rejected", r.status_code == 400)

# Transaction history
r = requests.get(f"{BASE}/api/characters/{CHAR_ID}/transactions")
check("Transaction history", r.status_code == 200 and len(r.json()) >= 2)

# ── Reputation endpoints ──
print("\n\u2500\u2500 Reputation \u2500\u2500")

# Set reputation
r = requests.patch(f"{BASE}/api/npc/{NPC_ID}/reputation/{CHAR_ID}",
                   json={"reputation_value": 50})
d = r.json()
check("Set reputation=50", r.status_code == 200 and d.get("reputation_value") == 50,
      f"mult={d.get('price_multiplier')}")

# Adjust reputation
r = requests.post(f"{BASE}/api/npc/{NPC_ID}/reputation/{CHAR_ID}/adjust",
                  json={"delta": -20})
d = r.json()
check("Adjust -20 => 30", d.get("reputation_value") == 30)

# Get all reputations
r = requests.get(f"{BASE}/api/npc/{NPC_ID}/reputation")
d = r.json()
check("Get reputations list", r.status_code == 200 and len(d.get("reputations", [])) >= 1)

# Reputation clamping
r = requests.patch(f"{BASE}/api/npc/{NPC_ID}/reputation/{CHAR_ID}",
                   json={"reputation_value": 200})
d = r.json()
check("Clamped to 100", d.get("reputation_value") == 100, f"val={d.get('reputation_value')}")

# ── NPC Shop endpoints ──
print("\n\u2500\u2500 NPC Shop \u2500\u2500")

# Add items to shop — find a cheap item
items = requests.get(f"{BASE}/api/items").json()
test_item = items[0]  # first item
r = requests.post(f"{BASE}/api/npc/{NPC_ID}/shop",
                  json={"item_id": test_item["id"], "stock": 10})
d = r.json()
check("Add to shop", r.status_code == 200 and d.get("ok"), f"sid={d.get('shop_item_id')}")
shop_item_id = d.get("shop_item_id")

# Add a cheap item with price override for buy testing
cheap_item = items[1] if len(items) > 1 else items[0]
r2 = requests.post(f"{BASE}/api/npc/{NPC_ID}/shop",
                   json={"item_id": cheap_item["id"], "stock": 5, "price_override_copper": 100})
check("Add cheap item (100cp override)", r2.status_code == 200)
cheap_shop_id = r2.json().get("shop_item_id") if r2.status_code == 200 else None

# Get shop (with player_id for reputation pricing)
r = requests.get(f"{BASE}/api/npc/{NPC_ID}/shop", params={"player_id": CHAR_ID})
d = r.json()
check("Get shop with pricing", r.status_code == 200 and len(d.get("items", [])) >= 1,
      f"items={len(d.get('items', []))}, rep={d.get('reputation')}, mult={d.get('price_multiplier')}")

# Check reputation pricing: rep=100 -> 0.5x multiplier
first_shop_item = d["items"][0]
check("Price adjusted by reputation",
      first_shop_item["final_price_copper"] <= first_shop_item["base_price_copper"],
      f"base={first_shop_item['base_price_copper']} final={first_shop_item['final_price_copper']}")

# Patch shop item
r = requests.patch(f"{BASE}/api/npc/{NPC_ID}/shop/{shop_item_id}",
                   json={"stock": 20})
check("Patch shop stock", r.status_code == 200)

# Delete shop item
if len(items) > 1:
    r = requests.delete(f"{BASE}/api/npc/{NPC_ID}/shop/{shop_item_id + 1 if shop_item_id else 2}")

# ── Trading endpoints ──
print("\n\u2500\u2500 Trading \u2500\u2500")

# Initiate trade
r = requests.post(f"{BASE}/api/trade/initiate",
                  json={"npc_id": NPC_ID, "player_id": CHAR_ID})
d = r.json()
check("Initiate trade", r.status_code == 200 and d.get("ok"), f"trade_id={d.get('trade_id')}")
trade_id = d.get("trade_id")

# Get trade
r = requests.get(f"{BASE}/api/trade/{trade_id}")
check("Get trade details", r.status_code == 200 and r.json().get("status") == "open")

# Buy item — use existing shop item (cheapest)
# Ensure player has enough gold and is alive
requests.post(f"{BASE}/api/characters/{CHAR_ID}/give-gold", json={"gold": 10})
requests.patch(f"{BASE}/api/characters/{CHAR_ID}/hp", json={"set": 50})

# Get shop items and pick cheapest
shop_data = requests.get(f"{BASE}/api/npc/{NPC_ID}/shop", params={"player_id": CHAR_ID}).json()
shop_sorted = sorted(shop_data["items"], key=lambda x: x["final_price_copper"])
buy_shop_id = shop_sorted[0]["shop_item_id"] if shop_sorted else None

r = requests.post(f"{BASE}/api/trade/{trade_id}/buy",
                  json={"shop_item_id": buy_shop_id, "quantity": 1})
d = r.json() if r.status_code == 200 else {"ok": False, "detail": r.text[:200]}
check("Buy item from trade", r.status_code == 200 and d.get("ok"),
      f"item={d.get('item_name')} cost={d.get('total_cost_copper')}")

# Check item was added to inventory
if d.get("ok"):
    inv = requests.get(f"{BASE}/api/characters/{CHAR_ID}/inventory").json()
    bought_items = [i for i in inv["items"] if i["name"] == d.get("item_name")]
    check("Item in player inventory after buy", len(bought_items) >= 1)
else:
    check("Item in player inventory after buy", False, f"buy failed: {d}")

# Close trade
r = requests.post(f"{BASE}/api/trade/{trade_id}/close")
check("Close trade", r.status_code == 200 and r.json().get("status") == "closed")

# Verify closed trade can't buy
r = requests.post(f"{BASE}/api/trade/{trade_id}/buy",
                  json={"shop_item_id": 1, "quantity": 1})
check("Closed trade rejects buy", r.status_code == 404)

# ── Session transactions (GM view) ──
print("\n\u2500\u2500 Session Transactions \u2500\u2500")
r = requests.get(f"{BASE}/api/sessions/DARK-9562/transactions")
d = r.json()
check("Session transactions", r.status_code == 200 and len(d.get("transactions", [])) >= 3,
      f"count={len(d.get('transactions', []))}")

# ── Reputation pricing test ──
print("\n\u2500\u2500 Price Formula \u2500\u2500")
# Set rep to -100 → prices doubled
requests.patch(f"{BASE}/api/npc/{NPC_ID}/reputation/{CHAR_ID}",
               json={"reputation_value": -100})
shop_neg = requests.get(f"{BASE}/api/npc/{NPC_ID}/shop", params={"player_id": CHAR_ID}).json()
if shop_neg["items"]:
    item_neg = shop_neg["items"][0]
    check("Rep -100 → 1.5x price",
          item_neg["final_price_copper"] == int(item_neg["base_price_copper"] * 1.5),
          f"base={item_neg['base_price_copper']} final={item_neg['final_price_copper']}")

# Set rep to 100 → 50% discount
requests.patch(f"{BASE}/api/npc/{NPC_ID}/reputation/{CHAR_ID}",
               json={"reputation_value": 100})
shop_pos = requests.get(f"{BASE}/api/npc/{NPC_ID}/shop", params={"player_id": CHAR_ID}).json()
if shop_pos["items"]:
    item_pos = shop_pos["items"][0]
    check("Rep +100 → 0.5x price",
          item_pos["final_price_copper"] == max(1, int(item_pos["base_price_copper"] * 0.5)),
          f"base={item_pos['base_price_copper']} final={item_pos['final_price_copper']}")

print("\n" + "=" * 60)
print(f"Results: {passed}/{total} passed")
print("=" * 60)
