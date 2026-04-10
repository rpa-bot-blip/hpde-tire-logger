# HPDE Tire Pressure Logger

An offline-capable web app for logging tire pressures at HPDE track events.

## How to Install on iPad

1. **Serve the app** — the app needs to be accessible via a browser. Use one of:
   - Your home LAN server (e.g. `http://192.168.4.72:8001/tire-pressure-app/`)
   - Or copy the files to any static web host

2. **Open in Safari** on your iPad (must be Safari for PWA install)

3. **Tap the Share button** (box with arrow icon)

4. **Tap "Add to Home Screen"**

5. The app will now appear on your home screen and **work fully offline** — no internet needed at the track!

---

## How to Serve It (from your home machine)

```bash
cd /home/jarvis/.openclaw/workspace
python3 -m http.server 8001
```

Then on your iPad, navigate to: `http://192.168.4.72:8001/tire-pressure-app/`

---

## Using the App

### New Session
1. Tap **+ New Session**
2. Enter Event Name, Track, Session Type (Practice/Hot Lap/Qualifying/Race), Session #
3. Optional: add car/setup notes
4. Tap **Start Session**

### Logging Tire Pressures
- The session view shows a **2×2 tire grid** (FL, FR, RL, RR) — matches the car layout
- Each tile shows the last logged PSI, hot/cold state, and delta from target
- Scroll down to the **Log Entry** section
- For each wheel, enter:
  - **Actual PSI** (e.g. 32.5)
  - **Target PSI** (optional — app shows +/- delta)
  - **❄️ Cold / 🔥 Hot** toggle
  - Notes (optional)
- Enter **Ambient Temp** if desired
- Tap **💾 Log All 4 Tires** to save with current timestamp

### Session Summary
Tap **Summary** in the header to see a clean 2×2 view of the latest pressures with deltas from target.

### History
Each session shows a full timestamped log of all readings. You can delete individual readings.

### Export
Tap **Export CSV** on the home screen or summary view to download a CSV file compatible with Excel/Numbers.

---

## Color Coding

| Color | Meaning |
|-------|---------|
| 🟡 Orange | PSI above target |
| 🔵 Blue | PSI below target |
| 🟢 Green | PSI within 0.5 PSI of target |

---

## Data Storage
All data is saved locally on the device using `localStorage`. No data is ever sent anywhere.
To back up your data, use the **Export CSV** feature regularly.
