# 🚀 Quick Start Guide — Both Projects

---

## 💸 SpendSmart PWA

### Run in 60 seconds
```bash
# Option 1 — VS Code (recommended)
# 1. Install "Live Server" extension in VS Code
# 2. Open the expense-pwa/ folder
# 3. Right-click index.html → "Open with Live Server"
# ✅ App runs at http://127.0.0.1:5500

# Option 2 — Python (if installed)
cd expense-pwa
python3 -m http.server 8080
# Visit http://localhost:8080

# Option 3 — Node
cd expense-pwa
npx serve .
```

> ⚠️ Do NOT open index.html directly as a file (file://) — Service Workers require a server

### What works immediately (no config needed)
- ✅ Add/delete/filter expenses
- ✅ Category donut chart
- ✅ Dark/light mode
- ✅ Monthly PDF report
- ✅ CSV export
- ✅ Offline storage (IndexedDB)
- ✅ Installable PWA

### Enable Cloud Sync (optional)
1. Go to https://supabase.com → Create free project
2. In SQL Editor, run:
```sql
create table expenses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  description text not null,
  amount numeric not null,
  category text not null,
  date date not null,
  receipt_url text,
  created_at timestamptz default now()
);
alter table expenses enable row level security;
create policy "own" on expenses for all using (auth.uid() = user_id);
```
3. Open `index.html`, find the `CFG` block at top of `<script>`:
```js
const CFG = {
  SUPABASE_URL:      'https://YOUR_PROJECT.supabase.co',  // ← paste here
  SUPABASE_ANON_KEY: 'YOUR_ANON_KEY',                     // ← paste here
  ...
};
```
4. Also add Supabase CDN before the closing `</body>` tag:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

### Enable Receipt Upload (optional)
1. Go to https://cloudinary.com → Free account
2. Settings → Upload → Add Upload Preset → Signing Mode = Unsigned → Name: `spendsmart_receipts`
3. In `index.html` CFG block:
```js
CLOUDINARY_NAME:   'your_cloud_name',  // ← from Cloudinary dashboard
CLOUDINARY_PRESET: 'spendsmart_receipts',
```

---

## 💬 ChatFlow Chat App

### Backend — Run in 2 minutes
```bash
cd chat-app/server
npm install
cp .env.example .env
# Edit .env — only MONGO_URI and JWT_SECRET are required
npm run dev
# ✅ Server at http://localhost:5000
```

**Minimum .env (required):**
```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/chatflow
JWT_SECRET=any_random_string_here_make_it_long
```

> MongoDB must be running locally. Install from https://www.mongodb.com/try/download/community
> Mac: `brew services start mongodb-community`
> Linux: `sudo systemctl start mongod`

### Frontend — Run in 2 minutes
```bash
cd chat-app/client

# Create Vite project
npm create vite@latest . -- --template react
# Choose "React" then "JavaScript"

npm install
npm install socket.io-client

# Copy App.jsx into src/App.jsx (replace the existing one)

# Create .env file in client/ folder:
echo "VITE_SERVER_URL=http://localhost:5000" > .env

npm run dev
# ✅ App at http://localhost:5173
```

### What works immediately
- ✅ Register / Login with avatars
- ✅ Multiple chat rooms (general, tech, random auto-created)
- ✅ Real-time messaging
- ✅ Message history
- ✅ Typing indicators
- ✅ Online count
- ✅ Emoji reactions (hover a message)
- ✅ Read receipts (✓ sent / ✓✓ seen)
- ✅ Message search (🔍 button)
- ✅ Create new rooms

### Enable File/Image Sharing (optional)
1. Cloudinary free account → Settings → Upload Preset (unsigned)
2. Add to server `.env`:
```env
CLOUDINARY_CLOUD_NAME=your_name
CLOUDINARY_API_KEY=your_key
CLOUDINARY_API_SECRET=your_secret
```
3. Restart server → 📎 button in chat now works

---

## ❓ Troubleshooting

| Problem | Fix |
|---|---|
| PWA: blank page | Open via Live Server, not file:// |
| PWA: chart not showing | Check internet (Chart.js loads from CDN) |
| Chat: "Cannot connect" | Make sure server is running on port 5000 |
| Chat: "MongoDB failed" | Start MongoDB service |
| Chat: CORS error | Check CLIENT_URL in .env matches your frontend port |
| Chat: socket auth error | Make sure JWT_SECRET is set in .env |

---

## 📋 Resume Bullets

### SpendSmart PWA
- Built offline-first PWA with IndexedDB and Service Worker — Lighthouse PWA score 100
- Generated monthly PDF reports using jsPDF with category bar charts and autotable
- Integrated Supabase with Row-Level Security for authenticated cross-device sync
- Implemented Cloudinary receipt upload with drag & drop, progress bar, and viewer modal
- Added Web Push budget alerts at 50/80/100% thresholds with daily reminders

### ChatFlow
- Architected real-time chat with Socket.io supporting rooms, typing, and message history
- Built emoji reaction system with live toggle and MongoDB Map for persistent storage
- Implemented file/image sharing with Cloudinary, paste-to-upload, and download links
- Added read receipts with double-tick indicator and per-message seen-by tracking
- Built message search with debounce, inline highlighting, and scroll-to-message navigation
