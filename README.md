<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Orion-Smart-Mirror

Orion Smart Mirror is a Raspberry Pi 3B+ powered interactive mirror that integrates real-time information, smart home control through Lovelace Home Assistant, and AI-powered skin analysis using the YouCam API. It provides personalized skincare insights, product recommendations, and a seamless smart living experience.

View your app in AI Studio: https://ai.studio/apps/7c474a95-efbb-4f94-bfa9-8e1630304c99

---

## Quick Download & Setup (User Manual)

### Step 1: One-Line Terminal Command to Download & Extract (Does Not Run App)

**For Windows PowerShell:**
```powershell
curl.exe -L https://files.catbox.moe/7nlh3b.zip -o orion.zip; Expand-Archive -Path orion.zip -DestinationPath . -Force; Remove-Item orion.zip
```

**For Windows CMD / macOS / Linux Terminal:**
```bash
curl -L https://files.catbox.moe/7nlh3b.zip -o orion.zip && tar -xf orion.zip && rm orion.zip
```

*(This downloads the archive, extracts the complete `orion_smart-mirror_3` folder into the current directory, and cleans up the `.zip` file.)*

**Or Clone via Git:**
```bash
git clone https://github.com/ShreyasNakode/Orion-Smart-Mirror.git
```

---

### Step 2: Launch the Application via `npm run desktop`

Once downloaded, the user can enter the folder, install dependencies once, and launch the desktop smart mirror:

```powershell
cd orion_smart-mirror_3
npm install
npm run desktop
```

---

## Run Locally (Development Mode)

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and fill in `GEMINI_API_KEY`, `YOUCAM_API_KEY`, `SPOTIFY_CLIENT_ID`, and `SPOTIFY_CLIENT_SECRET`.
3. In the Spotify developer dashboard, add `http://localhost:3001/api/spotify/callback` as a redirect URI.
4. Run the website version:
   `npm run dev`
5. Run the Windows desktop version:
   `npm run desktop`

## Windows Build

Create a Windows app folder in `release/`:

`npm run package:win`

The desktop app serves the exact React smart mirror UI locally and opens it in an Electron window. Google Calendar/Tasks continue to use Google sign-in through Firebase, and Spotify controls use Spotify OAuth plus the Web API.
