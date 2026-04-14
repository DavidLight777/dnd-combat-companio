import requests
BASE = "http://localhost:8000"

# Initiate trade
r = requests.post(f"{BASE}/api/trade/initiate", json={"npc_id": 4, "player_id": 3})
t = r.json()
tid = t["trade_id"]
print(f"Trade ID: {tid}")

# Get shop
shop = requests.get(f"{BASE}/api/npc/4/shop", params={"player_id": 3}).json()
print(f"Shop items: {len(shop['items'])}")
for i in shop["items"]:
    print(f"  shop_item_id={i['shop_item_id']} price={i['final_price_copper']}cp name={i['name'][:40]}")

# Player balance
cur = requests.get(f"{BASE}/api/characters/3/currency").json()
print(f"Player copper: {cur['total_copper']}")

# Try buy cheapest
cheap = sorted(shop["items"], key=lambda x: x["final_price_copper"])
if cheap:
    sid = cheap[0]["shop_item_id"]
    print(f"Buying shop_item_id={sid} price={cheap[0]['final_price_copper']}cp")
    r2 = requests.post(f"{BASE}/api/trade/{tid}/buy", json={"shop_item_id": sid, "quantity": 1})
    print(f"Buy status: {r2.status_code}")
    print(f"Buy response: {r2.text[:500]}")
