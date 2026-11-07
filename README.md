# Simi Hunt

A location-based collecting game prototype: walk the map, catch Dr. Simi in 18 outfits, visit participating pharmacies, and scan shelf-sign QR codes to unlock store exclusives and see the products on that shelf. Built as a concept demo for a case competition.

**Play:** https://olivesz.github.io/simi-hunt/app/ (best on a phone; add `?presenter=1` for the stage demo controls)

## Run it locally

No install or build step is needed, only Python 3 (already on macOS):

```bash
git clone https://github.com/Olivesz/simi-hunt.git
cd simi-hunt
python3 -m http.server 8000
```

Open http://localhost:8000/app/ in a browser. The camera, GPS and QR scanning need either localhost or HTTPS, so open it on a phone through the GitHub Pages link above.

## What's inside

- `app/`: the web app (no build step; plain ES modules)
- `art/`: character and player art
- `print/`: printable shelf signs with working QR codes

Map data © OpenStreetMap contributors. Dr. Simi and product images belong to their respective owners and are used here for a non-commercial concept demo only.
