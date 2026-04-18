# 🎬 Reels Scheduler — Multi-Platform Auto-Poster

> **Upload once. Post everywhere.** Schedule and auto-publish short-form video content to Instagram Reels, Facebook Reels, and YouTube Shorts from a single sleek dashboard.

![Version](https://img.shields.io/badge/version-2.0.0-7c5cfc?style=flat-square)
![Node](https://img.shields.io/badge/node-%3E%3D18-green?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

---

## ✨ Features

- **Multi-Platform Posting** — Publish to Instagram Reels, Facebook Reels, and YouTube Shorts in one click
- **Drag & Drop Upload** — Drop your video file directly into the browser; it's uploaded to Cloudinary and a public URL is stored
- **Schedule for Later** — Pick a date & time; the built-in scheduler checks every 30 seconds and auto-triggers due posts
- **Real-Time Progress** — Server-Sent Events (SSE) stream live logs to the browser as each platform is processed
- **Persistent Queue** — All posts are saved to `queue.json` on disk so they survive server restarts
- **Retry Mechanism** — Failed posts can be individually retried without re-uploading the video
- **Credential Manager** — Enter API keys in the browser UI and save them directly to `.env` — no manual file editing needed
- **Full Run Logs** — Every workflow event is timestamped and viewable in the Run Logs tab
- **Debug Endpoint** — `/api/debug` shows masked credential values so you can verify config without exposing secrets

---

## 🖥️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML + CSS + JavaScript (single-page app) |
| Backend | Node.js + Express |
| Video Hosting | Cloudinary (unsigned or signed upload) |
| Instagram | Graph API v23.0 — REELS |
| Facebook | Graph API v23.0 — `/video_reels` |
| YouTube | Data API v3 — OAuth2 Resumable Upload (#Shorts) |
| Persistence | Flat-file `queue.json` |
| Real-Time | Server-Sent Events (SSE) |

---

## 📁 Project Structure

```
reels-scheduler/
├── public/
│   └── index.html        # Full single-page frontend (UI + JS)
├── server.js             # Express backend — API routes & workflow engine
├── queue.json            # Auto-generated post queue (persisted to disk)
├── .env                  # Your real credentials (DO NOT commit)
├── .env.example          # Template — copy this to .env and fill in values
├── package.json
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18 or later
- A **Cloudinary** account (free tier works)
- API credentials for at least one of: Instagram, Facebook, YouTube

### 1. Clone & Install

```bash
git clone https://github.com/satyamsen7/Reels-Shorts-Scheduler.git
cd Reels-Shorts-Scheduler
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in your credentials (see [Credentials Reference](#-credentials-reference) below).

> **Tip:** You can also fill in credentials directly from the browser UI at `http://localhost:3000` → **Credentials** tab. They are written to `.env` automatically.

### 3. Start the Server

```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

Open **http://localhost:3000** in your browser.

---

## 🔑 Credentials Reference

Copy `.env.example` to `.env` and fill in the values below.

```env
PORT=3000

# ── Instagram (Graph API v23.0) ──────────────────────────────
IG_TOKEN=EAAxxxxxxxxxxxxxxx        # Long-lived Page/IG access token
IG_USER_ID=17841400000000000       # Instagram Business/Creator account ID

# ── Facebook (Page Access Token) ────────────────────────────
FB_PAGE_ID=123456789012345         # Facebook Page ID
FB_PAGE_TOKEN=EAAxxxxxxxxxxxxxxx   # Page Access Token with pages_manage_posts scope

# ── YouTube (OAuth2) ─────────────────────────────────────────
YT_CLIENT_ID=xxxxxx.apps.googleusercontent.com
YT_CLIENT_SECRET=GOCSPX-xxxxxxxx
YT_REFRESH_TOKEN=1//xxxxxxxxxxxxxxxxxxxxxxxx

# ── Cloudinary ───────────────────────────────────────────────
CLOUDINARY_CLOUD_NAME=my-cloud-name
CLOUDINARY_UPLOAD_PRESET=ml_default        # Unsigned upload preset
CLOUDINARY_API_KEY=                        # Optional — for signed uploads
CLOUDINARY_API_SECRET=                     # Optional — for signed uploads
```

### How to Obtain Each Credential

<details>
<summary><strong>Instagram — Access Token & User ID</strong></summary>

1. Create a [Meta Developer App](https://developers.facebook.com/) with the **Instagram Graph API** product.
2. Add an Instagram Business or Creator account and grant `instagram_content_publish` scope.
3. Generate a **Long-Lived User Access Token** (valid 60 days — set up a refresh cron for production).
4. Find your **IG User ID** via `GET /me?fields=id` with the token.

</details>

<details>
<summary><strong>Facebook — Page ID & Page Access Token</strong></summary>

1. From your Meta Developer App, add the **Pages API** product.
2. Grant scopes: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`.
3. Use Graph Explorer to call `GET /me/accounts` to retrieve your **Page ID** and **Page Access Token**.
4. Exchange for a **long-lived Page Access Token** (never expires for pages).

</details>

<details>
<summary><strong>YouTube — OAuth2 Credentials</strong></summary>

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → Create a project.
2. Enable the **YouTube Data API v3**.
3. Create **OAuth 2.0 credentials** (type: Web Application). Add `http://localhost` as an authorized redirect URI.
4. Use [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) to get a **Refresh Token** with the `https://www.googleapis.com/auth/youtube.upload` scope.

</details>

<details>
<summary><strong>Cloudinary — Cloud Name & Upload Preset</strong></summary>

1. Sign up at [cloudinary.com](https://cloudinary.com) (free tier: 25 GB storage).
2. Find your **Cloud Name** on the Dashboard.
3. Go to **Settings → Upload → Upload presets** → Add a preset set to **Unsigned**.
4. Copy the preset name as `CLOUDINARY_UPLOAD_PRESET`.

</details>

---

## 📖 Usage Guide

### Creating a New Post

1. Navigate to **New Post** in the sidebar.
2. **Drag & drop** your video file (MP4, MOV, AVI — max 500 MB) or click to browse.
3. Wait for the Cloudinary upload to complete (progress bar shown).
4. Fill in **Title**, **Caption**, and optional **Tags** (comma-separated).
5. **Select platforms** — toggle Instagram, Facebook, and/or YouTube.
6. Choose **Post Now** to trigger immediately or **Schedule** to pick a future date/time.
7. Click **Add to Queue**.

### Queue Management

| Action | How |
|---|---|
| View all posts | **Queue** tab — filter by status |
| Run a scheduled post immediately | Click **▶ Run** in the Actions column |
| View post details | Click any row |
| Retry a failed post | Click **🔄 Retry** |
| Delete a post | Click **✕** |

### Monitoring

- **Dashboard** — At-a-glance stats and live platform activity log
- **Run Logs** — Full timestamped event log for every workflow run (persisted in `localStorage`)
- **Workflow Pipeline** — Visual indicator highlighting which step is currently running

---

## 🔌 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/queue` | List all queued posts |
| `POST` | `/api/queue` | Add a new post to the queue |
| `DELETE` | `/api/queue/:id` | Remove a post |
| `POST` | `/api/queue/:id/retry` | Reset a failed post to `Scheduled to post` |
| `POST` | `/api/queue/bind-buffer` | Associate an uploaded video buffer with a post ID |
| `POST` | `/api/upload` | Upload a video to Cloudinary (multipart/form-data, field: `video`) |
| `POST` | `/api/run` | Trigger a post workflow (`{ postId, sessionId }`) |
| `GET` | `/api/logs/stream/:sessionId` | SSE stream — connects and receives real-time log events |
| `GET` | `/api/credentials` | Read current credentials from `.env` (masked) |
| `POST` | `/api/credentials` | Write credentials to `.env` |
| `GET` | `/api/debug` | Returns masked credential values for debugging |
| `GET` | `/api/health` | Health check — returns `{ ok: true, ts: "..." }` |

---

## 🔄 Workflow Pipeline

```
[Upload Video] → [Cloudinary] → ┌─ [Instagram: Create Container → Poll → Publish]
                                 ├─ [Facebook: Start Upload → PUT Binary → Finish]
                                 └─ [YouTube: OAuth2 Token → Resumable Upload]
                                         ↓
                                    [Done ✅]
```

- **Instagram** and **Facebook** receive the video from Cloudinary (public URL).
- **Facebook** and **YouTube** receive the raw video bytes directly (buffered in memory or re-downloaded from Cloudinary).
- All three platforms run **in parallel** via `Promise.allSettled` — a failure on one platform does not block others.
- Per-platform results are stored back to `queue.json` (post ID, or `ERR:<message>` on failure).

---

## ⚙️ Scheduler

The built-in scheduler runs every **30 seconds** in the background. It scans `queue.json` for posts with:

- `status === "Scheduled to post"`
- `scheduledAt` timestamp ≤ current time

Matching posts are automatically triggered via `runWorkflow()`.

> **Note:** The scheduler operates in-process. If you restart the server, scheduled posts will be picked up again on the next 30-second tick.

---

## 🛡️ Security Notes

- **Never commit `.env`** — it is listed in `.gitignore`.
- The `/api/credentials` endpoint reads/writes your `.env` file. Ensure the server is not publicly accessible without authentication in production.
- Cloudinary API Key & Secret are optional. If not provided, unsigned uploads are used instead.
- YouTube OAuth2 Refresh Tokens do not expire (unless revoked). Store them securely.

---

## 🐛 Troubleshooting

| Issue | Solution |
|---|---|
| Upload fails with "Cloudinary credentials not configured" | Set `CLOUDINARY_CLOUD_NAME` and `CLOUDINARY_UPLOAD_PRESET` in **Credentials** tab or `.env` |
| Instagram returns container error | Ensure your video meets [IG Reels specs](https://developers.facebook.com/docs/instagram-api/reference/ig-user/media): MP4, H.264, max 15 min, aspect ratio 9:16 |
| YouTube OAuth2 fails | Double-check `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, and `YT_REFRESH_TOKEN`. Visit `/api/debug` to verify values are loaded |
| Facebook upload times out | Large files (>300 MB) may hit the 5-min timeout. Try a smaller video or increase `timeout` in `postToFacebook()` |
| Scheduler not firing | Verify server is running and the post's `scheduledAt` is in the past. Check server console for `[Scheduler]` log lines |
| Post stuck at "Processing" after server restart | Use **Retry** button on the Queue page to reset it to `Scheduled to post` |

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/awesome-feature`)
3. Commit your changes (`git commit -m 'Add awesome feature'`)
4. Push to the branch (`git push origin feature/awesome-feature`)
5. Open a Pull Request

---

## 📄 License

MIT © [satyamsen7](https://github.com/satyamsen7)
