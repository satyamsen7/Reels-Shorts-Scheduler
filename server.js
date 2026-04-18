'use strict';
require('dotenv').config();

const express  = require('express');
const axios    = require('axios');
const FormData = require('form-data');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');

const app      = express();
const PORT     = process.env.PORT || 3000;
const ENV_PATH = path.resolve(__dirname, '.env');
const QUEUE_PATH = path.resolve(__dirname, 'queue.json');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer — store video in memory (max 500 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// ─────────────────────────────────────────────────────────────────────────────
// .ENV FILE  —  read / write helpers
// ─────────────────────────────────────────────────────────────────────────────

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const result = {};
  fs.readFileSync(ENV_PATH, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) result[m[1].trim()] = m[2].trim();
  });
  return result;
}

function writeEnvFile(updates) {
  const current = readEnvFile();
  const merged  = { ...current, ...updates };
  Object.keys(merged).forEach(k => { if (merged[k] === '') delete merged[k]; });
  const content = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
  Object.assign(process.env, updates);
}

function getEnvCreds() {
  return {
    ig_token:      process.env.IG_TOKEN                 || '',
    ig_user:       process.env.IG_USER_ID               || '',
    fb_page:       process.env.FB_PAGE_ID               || '',
    fb_token:      process.env.FB_PAGE_TOKEN            || '',
    yt_clientid:   process.env.YT_CLIENT_ID             || '',
    yt_secret:     process.env.YT_CLIENT_SECRET         || '',
    yt_refresh:    process.env.YT_REFRESH_TOKEN         || '',
    cloud_name:    process.env.CLOUDINARY_CLOUD_NAME    || '',
    cloud_preset:  process.env.CLOUDINARY_UPLOAD_PRESET || '',
    cloud_api_key: process.env.CLOUDINARY_API_KEY       || '',
    cloud_secret:  process.env.CLOUDINARY_API_SECRET    || '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE  —  persist to queue.json
// ─────────────────────────────────────────────────────────────────────────────

function readQueue() {
  if (!fs.existsSync(QUEUE_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8')); }
  catch { return []; }
}

function writeQueue(q) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2), 'utf-8');
}

function updatePostInQueue(id, changes) {
  const q    = readQueue();
  const idx  = q.findIndex(p => p.id === id);
  if (idx !== -1) { Object.assign(q[idx], changes); writeQueue(q); }
  return q[idx] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVER-SENT EVENTS  —  real-time log streaming to the browser
// ─────────────────────────────────────────────────────────────────────────────
const sseClients = new Map();

app.get('/api/logs/stream/:sessionId', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  sseClients.set(req.params.sessionId, res);
  req.on('close', () => sseClients.delete(req.params.sessionId));
});

function sseLog(sessionId, node, msg, type = '') {
  const client = sseClients.get(sessionId);
  if (client) client.write(`data: ${JSON.stringify({ node, msg, type })}\n\n`);
  console.log(`[${node}] ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLOUDINARY UPLOAD
// ─────────────────────────────────────────────────────────────────────────────
async function uploadToCloudinary(buffer, fileName, c) {
  console.log(`[Cloudinary] cloud_name="${c.cloud_name}" preset="${c.cloud_preset}" api_key="${c.cloud_api_key ? c.cloud_api_key.slice(0,6)+'…' : '(none)'}"`);

  const form = new FormData();
  form.append('file', buffer, { filename: fileName, contentType: 'video/mp4' });
  form.append('resource_type', 'video');

  if (c.cloud_api_key && c.cloud_secret) {
    // ── Signed upload ─────────────────────────────────────────────────────────
    // Cloudinary signature: alphabetically sorted params (excluding file/resource_type)
    // then append API secret with NO separator
    const timestamp = Math.floor(Date.now() / 1000).toString();
    // Only sign params that are actually sent (timestamp + any extra params)
    // Do NOT include upload_preset if the preset is set to "signed" mode — include it
    // Do NOT include upload_preset if the preset is "unsigned" — skip it here
    const paramsToSign = { timestamp };
    const paramStr = Object.keys(paramsToSign).sort()
      .map(k => `${k}=${paramsToSign[k]}`)
      .join('&');
    const signature = crypto.createHash('sha1').update(paramStr + c.cloud_secret).digest('hex');

    form.append('api_key',   c.cloud_api_key);
    form.append('timestamp', timestamp);
    form.append('signature', signature);
    // Do NOT append upload_preset for signed uploads unless your preset is in "signed" mode
    console.log(`[Cloudinary] Using SIGNED upload — signature computed`);
  } else {
    // ── Unsigned upload ───────────────────────────────────────────────────────
    form.append('upload_preset', c.cloud_preset);
    console.log(`[Cloudinary] Using UNSIGNED upload with preset "${c.cloud_preset}"`);
  }

  const url = `https://api.cloudinary.com/v1_1/${c.cloud_name}/video/upload`;
  console.log(`[Cloudinary] POST → ${url}`);

  const resp = await axios.post(url, form, {
    headers: { ...form.getHeaders() },
    maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 300_000,
  });
  return resp.data.secure_url;
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTAGRAM  (Graph API v23.0 — REELS)
// ─────────────────────────────────────────────────────────────────────────────
async function postToInstagram(videoUrl, caption, c) {
  const BASE = 'https://graph.facebook.com/v23.0';

  const create = await axios.post(`${BASE}/${c.ig_user}/media`, null, {
    params: { media_type: 'REELS', video_url: videoUrl, caption, access_token: c.ig_token },
  });
  const containerId = create.data.id;

  // Poll until FINISHED  (max 90 × 5s = 7.5 min)
  for (let i = 0; i < 90; i++) {
    await sleep(5000);
    const s = await axios.get(`${BASE}/${containerId}`, {
      params: { fields: 'status_code,status', access_token: c.ig_token },
    });
    if (s.data.status_code === 'FINISHED') break;
    if (s.data.status_code === 'ERROR') throw new Error('IG container error: ' + s.data.status);
  }

  const pub = await axios.post(`${BASE}/${c.ig_user}/media_publish`, null, {
    params: { creation_id: containerId, access_token: c.ig_token },
  });
  return pub.data.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// FACEBOOK  (/video_reels API)
// ─────────────────────────────────────────────────────────────────────────────
async function postToFacebook(videoBuffer, fileName, title, description, c) {
  const BASE = 'https://graph.facebook.com/v23.0';

  const init = await axios.post(`${BASE}/${c.fb_page}/video_reels`, null, {
    params: { upload_phase: 'start', file_size: videoBuffer.length, access_token: c.fb_token },
  });
  const { video_id, upload_url } = init.data;

  await axios.put(upload_url, videoBuffer, {
    headers: { Authorization: `OAuth ${c.fb_token}`, offset: '0', file_size: videoBuffer.length.toString(), 'Content-Type': 'application/octet-stream' },
    maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 300_000,
  });

  await axios.post(`${BASE}/${c.fb_page}/video_reels`, null, {
    params: { upload_phase: 'finish', video_id, video_state: 'PUBLISHED', title, description, access_token: c.fb_token },
  });
  return video_id;
}

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE  (Data API v3 — Shorts via resumable upload)
// ─────────────────────────────────────────────────────────────────────────────
async function getYouTubeAccessToken(c) {
  try {
    const resp = await axios.post('https://oauth2.googleapis.com/token', {
      client_id:     c.yt_clientid,
      client_secret: c.yt_secret,
      refresh_token: c.yt_refresh,
      grant_type:    'refresh_token',
    });
    return resp.data.access_token;
  } catch (err) {
    // Extract Google's actual error message
    const gErr = err.response?.data;
    const detail = gErr
      ? `${gErr.error}: ${gErr.error_description}`
      : err.message;
    console.error('[YouTube] OAuth2 token error →', detail);
    console.error('[YouTube] client_id set?', !!c.yt_clientid, '| secret set?', !!c.yt_secret, '| refresh set?', !!c.yt_refresh);
    throw new Error(`YouTube OAuth2 failed — ${detail}`);
  }
}

async function postToYouTube(videoBuffer, title, description, accessToken) {
  const shortTitle = title.includes('#Shorts') ? title : `${title} #Shorts`;
  const meta = {
    snippet: { title: shortTitle, description, categoryId: '22', tags: ['Shorts'] },
    status:  { privacyStatus: 'public' },
  };

  const init = await axios.post(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    meta,
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': videoBuffer.length } }
  );

  const up = await axios.put(init.headers.location, videoBuffer, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'video/mp4', 'Content-Length': videoBuffer.length },
    maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 600_000,
  });
  return up.data.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// MAIN WORKFLOW  —  videoBuffer needed only for FB/YT; IG uses Cloudinary URL
// ─────────────────────────────────────────────────────────────────────────────

// In-memory buffer cache so scheduler can re-use buffers for scheduled posts
// NOTE: for very large files / long schedules, consider disk temp storage
const videoBufferCache = new Map(); // postId → Buffer

async function runWorkflow(post, sessionId) {
  const log = (node, msg, type = '') => sseLog(sessionId, node, msg, type);
  const c   = getEnvCreds();

  try {
    // ── Validate credentials per selected platform ────────────────────────────
    const plat = post.platforms || [];
    const missing = [];
    if (plat.includes('instagram') && (!c.ig_token || !c.ig_user))                        missing.push('Instagram token/user-id');
    if (plat.includes('facebook')  && (!c.fb_page  || !c.fb_token))                       missing.push('Facebook page-id/token');
    if (plat.includes('youtube')   && (!c.yt_clientid || !c.yt_secret || !c.yt_refresh))  missing.push('YouTube OAuth credentials');
    if (missing.length) throw new Error('Missing credentials: ' + missing.join(', '));

    updatePostInQueue(post.id, { status: 'Processing' });
    log('Workflow', `Starting workflow for "${post.title}"`, 'info');
    log('Workflow', `Platforms: ${plat.join(', ')}`, 'info');

    // ── Retrieve video buffer (from cache or re-download if needed) ───────────
    let videoBuffer = videoBufferCache.get(post.id);
    if (!videoBuffer && post.videoUrl) {
      log('Download', 'Fetching video from Cloudinary for FB/YT upload…', 'info');
      const resp = await axios.get(post.videoUrl, { responseType: 'arraybuffer', timeout: 120_000 });
      videoBuffer = Buffer.from(resp.data);
      log('Download', `Ready — ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB`, 'ok');
    }

    // ── Post to selected platforms in parallel ────────────────────────────────
    log('Branch', `Posting to ${plat.join(' · ')} in parallel…`, 'info');
    const caption = [post.caption || '', post.tags ? post.tags.split(',').map(t => '#' + t.trim().replace(/^#/, '')).join(' ') : ''].filter(Boolean).join('\n');

    const tasks = {
      instagram: plat.includes('instagram')
        ? (async () => {
            log('Instagram', 'Creating REELS media container…', 'info');
            const id = await postToInstagram(post.videoUrl, caption, c);
            log('Instagram', `✅ Reel published — ID: ${id}`, 'ok');
            return id;
          })()
        : Promise.resolve(null),

      facebook: plat.includes('facebook')
        ? (async () => {
            log('Facebook', `Uploading reel to Page ${c.fb_page}…`, 'info');
            const id = await postToFacebook(videoBuffer, post.title + '.mp4', post.title, caption, c);
            log('Facebook', `✅ Reel published — video_id: ${id}`, 'ok');
            return id;
          })()
        : Promise.resolve(null),

      youtube: plat.includes('youtube')
        ? (async () => {
            log('YouTube', 'Refreshing OAuth2 token…', 'info');
            const token = await getYouTubeAccessToken(c);
            log('YouTube', `Uploading Short: "${post.title} #Shorts"…`, 'info');
            const id = await postToYouTube(videoBuffer, post.title, caption, token);
            log('YouTube', `✅ Short published — ID: ${id}`, 'ok');
            return id;
          })()
        : Promise.resolve(null),
    };

    const [igRes, fbRes, ytRes] = await Promise.allSettled([tasks.instagram, tasks.facebook, tasks.youtube]);

    const igId = igRes.status === 'fulfilled' ? (igRes.value || '') : `ERR:${igRes.reason?.message}`;
    const fbId = fbRes.status === 'fulfilled' ? (fbRes.value || '') : `ERR:${fbRes.reason?.message}`;
    const ytId = ytRes.status === 'fulfilled' ? (ytRes.value || '') : `ERR:${ytRes.reason?.message}`;

    if (igRes.status === 'rejected') log('Instagram', `⚠ ${igRes.reason?.message}`, 'err');
    if (fbRes.status === 'rejected') log('Facebook',  `⚠ ${fbRes.reason?.message}`, 'err');
    if (ytRes.status === 'rejected') log('YouTube',   `⚠ ${ytRes.reason?.message}`, 'err');

    // ── Finalise ──────────────────────────────────────────────────────────────
    updatePostInQueue(post.id, { status: 'Processed', instagramId: igId, facebookId: fbId, youtubeId: ytId });
    videoBufferCache.delete(post.id);  // free memory

    log('Done', 'All done ✅', 'ok');
    sseLog(sessionId, 'Complete', JSON.stringify({ igId, fbId, ytId }), 'done');

  } catch (err) {
    log('Error', err.message, 'err');
    updatePostInQueue(post.id, { status: 'Failed' });
    videoBufferCache.delete(post.id);
    sseLog(sessionId, 'Error', err.message, 'fatal');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER  —  checks every 30s for due posts
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => {
  const q   = readQueue();
  const now = Date.now();
  q.filter(p => p.status === 'Scheduled to post' && p.scheduledAt && new Date(p.scheduledAt).getTime() <= now)
   .forEach(post => {
     console.log(`[Scheduler] Auto-triggering ${post.id}`);
     const sessionId = 'auto-' + Date.now();
     runWorkflow(post, sessionId).catch(console.error);
   });
}, 30_000);

// ─────────────────────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── Credentials ──────────────────────────────────────────────────────────────
app.get('/api/credentials', (_req, res) => res.json(getEnvCreds()));

app.post('/api/credentials', (req, res) => {
  const envMap = {
    ig_token: 'IG_TOKEN', ig_user: 'IG_USER_ID',
    fb_page: 'FB_PAGE_ID', fb_token: 'FB_PAGE_TOKEN',
    yt_clientid: 'YT_CLIENT_ID', yt_secret: 'YT_CLIENT_SECRET', yt_refresh: 'YT_REFRESH_TOKEN',
    cloud_name: 'CLOUDINARY_CLOUD_NAME', cloud_preset: 'CLOUDINARY_UPLOAD_PRESET',
    cloud_api_key: 'CLOUDINARY_API_KEY', cloud_secret: 'CLOUDINARY_API_SECRET',
  };
  const updates = {};
  for (const [k, v] of Object.entries(envMap)) {
    if (req.body[k] !== undefined) updates[v] = req.body[k];
  }
  try { writeEnvFile(updates); res.json({ saved: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Video Upload → Cloudinary ─────────────────────────────────────────────────
app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file received' });
    const c = getEnvCreds();
    if (!c.cloud_name || !c.cloud_preset) return res.status(400).json({ error: 'Cloudinary credentials not configured' });

    const url = await uploadToCloudinary(req.file.buffer, req.file.originalname, c);

    // Cache buffer keyed by temp ID for reuse during same session
    const tempId = 'tmp-' + Date.now();
    videoBufferCache.set(tempId, req.file.buffer);

    res.json({ url, tempId, size: req.file.size, name: req.file.originalname });
  } catch (err) {
    console.error('[Upload]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Queue CRUD ────────────────────────────────────────────────────────────────
app.get('/api/queue', (_req, res) => res.json(readQueue()));

app.post('/api/queue', (req, res) => {
  const post = req.body;
  if (!post.id || !post.videoUrl) return res.status(400).json({ error: 'id and videoUrl required' });
  const q = readQueue();
  q.push(post);
  writeQueue(q);
  res.json({ ok: true });
});

app.delete('/api/queue/:id', (req, res) => {
  const q = readQueue().filter(p => p.id !== req.params.id);
  writeQueue(q);
  videoBufferCache.delete(req.params.id);
  res.json({ ok: true });
});

// Reset a failed post back to "Scheduled to post" so it can be retried
app.post('/api/queue/:id/retry', (req, res) => {
  const q   = readQueue();
  const idx = q.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found' });
  Object.assign(q[idx], {
    status:      'Scheduled to post',
    instagramId: '',
    facebookId:  '',
    youtubeId:   '',
  });
  writeQueue(q);
  res.json({ ok: true, post: q[idx] });
});

// ── Run a post now ────────────────────────────────────────────────────────────
app.post('/api/run', (req, res) => {
  const { postId, sessionId } = req.body;
  if (!postId || !sessionId) return res.status(400).json({ error: 'postId and sessionId required' });

  const q    = readQueue();
  const post = q.find(p => p.id === postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  res.json({ started: true });
  runWorkflow(post, sessionId).catch(err => sseLog(sessionId, 'Error', err.message, 'fatal'));
});

// ── Transfer video buffer from upload temp-id to final post id ────────────────
app.post('/api/queue/bind-buffer', (req, res) => {
  const { tempId, postId } = req.body;
  const buf = videoBufferCache.get(tempId);
  if (buf) {
    videoBufferCache.delete(tempId);
    videoBufferCache.set(postId, buf);
  }
  res.json({ ok: true });
});

// ── Debug — shows what's currently in process.env (safe, masked) ─────────────
app.get('/api/debug', (_req, res) => {
  const c = getEnvCreds();
  const mask = v => v ? v.slice(0,4) + '…' + v.slice(-3) : '(not set)';
  res.json({
    CLOUDINARY_CLOUD_NAME:    c.cloud_name    || '(not set)',
    CLOUDINARY_UPLOAD_PRESET: c.cloud_preset  || '(not set)',
    CLOUDINARY_API_KEY:       mask(c.cloud_api_key),
    CLOUDINARY_API_SECRET:    mask(c.cloud_secret),
    IG_TOKEN:                 mask(c.ig_token),
    IG_USER_ID:               c.ig_user       || '(not set)',
    FB_PAGE_ID:               c.fb_page       || '(not set)',
    FB_PAGE_TOKEN:            mask(c.fb_token),
    YT_CLIENT_ID:             c.yt_clientid   || '(not set)',
    YT_CLIENT_SECRET:         mask(c.yt_secret),
    YT_REFRESH_TOKEN:         mask(c.yt_refresh),
  });
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Reels Scheduler v2 → http://localhost:${PORT}\n`);
});
