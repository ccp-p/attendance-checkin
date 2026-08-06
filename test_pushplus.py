import json
import re
import requests

TOKEN = "821c4bffa77242268d9664c3e3a24cce"
SECRET = "ogIU753RWNhMVOdUMn-3gHm4LvRI"
BASE = "https://www.pushplus.plus"

def get_access_key():
    r = requests.post(
        f"{BASE}/api/common/openApi/getAccessKey",
        json={"token": TOKEN, "secretKey": SECRET},
        timeout=10,
    )
    resp = r.json()
    print(f"getAccessKey: {json.dumps(resp, ensure_ascii=False)}")
    if resp.get("code") == 200 and isinstance(resp.get("data"), dict):
        return resp["data"].get("accessKey", "")
    return ""

def get_messages(key):
    r = requests.post(
        f"{BASE}/api/open/message/list",
        headers={"Content-Type": "application/json", "access-key": key},
        json={"current": 1, "pageSize": 5},
        timeout=10,
    )
    data = r.json()
    print(json.dumps(data, ensure_ascii=False, indent=2))
    for item in data.get("data", {}).get("list", []):
        title = item.get("title", "")
        sc = item.get("shortCode", "")
        m = re.search(r"\d{6}", title)
        code = m.group() if m else ""
        print(f"  sc={sc} len={len(title)} code={code} title={title}")

if __name__ == "__main__":
    key = get_access_key()
    if key:
        print(f"key={key}")
        get_messages(key)
    else:
        print("FAILED: no access key (IP not authorized?)")
