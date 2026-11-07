# Simi Hunt

A location-based collecting game prototype: walk the map, catch Dr. Simi in 18 outfits, visit participating pharmacies, and scan shelf-sign QR codes to unlock store exclusives and see the products on that shelf. Built as a concept demo for a case competition.

**Play:** https://olivesz.github.io/simi-hunt/app/ (best on a phone; add `?presenter=1` for the stage demo controls)

## Open it on a phone

**Fastest, with no setup:** open https://olivesz.github.io/simi-hunt/app/ on any phone. The camera, GPS and QR codes all work there.

**From your own copy:**

```bash
git clone https://github.com/Olivesz/simi-hunt.git
cd simi-hunt
./run.sh
```

`run.sh` only needs Python 3, which is already on macOS. It prints three addresses:
- **This computer:** `http://localhost:8000/app/`
- **Phones on the same Wi-Fi:** `http://<your-ip>:8000/app/?presenter=1`. Everything works except the camera and real GPS, because phones only allow those over HTTPS. Presenter mode lets you move, summon Simis and paste codes instead.
- **Any phone, over HTTPS:** if `cloudflared` is installed (`brew install cloudflared`), the script also prints a free https://….trycloudflare.com address, and the camera, GPS and QR scanning all work on it.

On Windows, run `python -m http.server 8000` in the folder and open `/app/`.

**Your own permanent link:** fork this repo, then go to Settings → Pages, set the source to the `main` branch, and save. Your copy appears at `https://<you>.github.io/simi-hunt/app/`.

## What's inside

- `app/`: the web app (no build step; plain ES modules)
- `art/`: character and player art
- `print/`: printable shelf signs with working QR codes

Map data © OpenStreetMap contributors. Dr. Simi and product images belong to their respective owners and are used here for a non-commercial concept demo only.
