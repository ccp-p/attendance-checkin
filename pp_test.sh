#!/system/bin/sh
TOKEN=821c4bffa77242268d9664c3e3a24cce
SECRET=ogIU753RWNhMVOdUMn-3gHm4LvRI
echo "{\"token\":\"$TOKEN\",\"secretKey\":\"$SECRET\"}" > /sdcard/pp_req.json
echo "=== GET ACCESS KEY ==="
RESP=$(curl -s --max-time 10 -X POST https://www.pushplus.plus/api/common/openApi/getAccessKey -H Content-Type:application/json -d @/sdcard/pp_req.json)
echo "$RESP"
KEY=$(echo "$RESP" | grep -o '"accessKey":"[^"]*"' | head -1 | sed 's/.*"accessKey":"//;s/".*//')
echo "=== KEY=$KEY ==="
if [ -z "$KEY" ]; then echo "FAILED: no key"; exit 1; fi
echo "=== MESSAGE LIST ==="
curl -s --max-time 10 -X POST https://www.pushplus.plus/api/open/message/list -H Content-Type:application/json -H "access-key: $KEY" -d '{"current":1,"pageSize":5}'
echo ""
echo "=== PARSE ==="
RESP2=$(curl -s --max-time 10 -X POST https://www.pushplus.plus/api/open/message/list -H Content-Type:application/json -H "access-key: $KEY" -d '{"current":1,"pageSize":5}')
echo "$RESP2" | grep -o '"title":"[^"]*"'
echo "---"
echo "$RESP2" | grep -o '"shortCode":"[^"]*"'
echo "---"
echo "$RESP2" | grep -o '"title":"[^"]*"' | sed 's/.*"title":"//;s/"$//' | while read -r t; do
  c=$(echo "$t" | grep -oE '[0-9]{6}' | head -1)
  echo "len=${#t} code=$t -> ${c:-none}"
done
