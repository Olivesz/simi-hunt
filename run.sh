#!/bin/bash
# Serve Simi Hunt from this folder and print the addresses phones can use.
PORT=${PORT:-8000}
cd "$(dirname "$0")"
IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
echo "Laptop:  http://localhost:$PORT/app/"
[ -n "$IP" ] && echo "Phones on the same Wi-Fi:  http://$IP:$PORT/app/?presenter=1   (map, catching, SimiDex and shelves work; the camera and real GPS need HTTPS)"
if command -v cloudflared >/dev/null 2>&1; then
  python3 -m http.server "$PORT" --bind 0.0.0.0 >/dev/null 2>&1 &
  SERVER=$!; trap 'kill $SERVER' EXIT
  echo "Starting an HTTPS link for any phone (camera, GPS and QR scanning all work). Use the https://....trycloudflare.com address below + /app/"
  cloudflared tunnel --url "http://localhost:$PORT"
else
  echo "Full camera + GPS on any phone: use https://olivesz.github.io/simi-hunt/app/  (or install cloudflared and re-run this script for your own HTTPS link)"
  python3 -m http.server "$PORT" --bind 0.0.0.0
fi
