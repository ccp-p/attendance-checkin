#!/system/bin/sh
# One-shot: fetch latest pushplus message and extract code
TOKEN=821c4bffa77242268d9664c3e3a24cce
SECRET=ogIU753RWNhMVOdUMn-3gHm4LvRI
KEY=$(curl -s --max-time 10 -X POST https://www.pushplus.plus/api/common/openApi/getAccessKey -H Content-Type:application/json -d "{\"token\":\"$TOKEN\",\"secretKey\":\"$SECRET\"}" | grep -o '"accessKey":"[^"]*"' | head -1 | sed 's/"accessKey":"//;s/"//')
if [ -z "$KEY" ]; then echo "FAILED: no key"; exit 1; fi
echo "key=$KEY"
RESP=$(curl -s --max-time 10 -X POST https://www.pushplus.plus/api/open/message/list -H Content-Type:application/json -H "access-key: $KEY" -d '{"current":1,"pageSize":3}')
echo "$RESP" | grep -o '"title":"[^"]*"' | sed 's/"title":"//;s/"$//' | while IFS= read -r t; do
  echo "title=[$t] len=${#t}"
  c=$(echo "$t" | grep -oE '[0-9]{6}' | head -1)
  if [ -n "$c" ]; then echo "CODE=$c"; fi
done
