// ================================================================
// ChatFlow — server.js  (run: npm install && npm run dev)
// ================================================================
require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const mongoose   = require('mongoose');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');

// Optional — only needed if Cloudinary env vars are set
let upload = null;
try {
  const cloudinary = require('cloudinary').v2;
  const multer = require('multer');
  const { CloudinaryStorage } = require('multer-storage-cloudinary');
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_CLOUD_NAME !== 'YOUR_CLOUD_NAME') {
    cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
    const storage = new CloudinaryStorage({ cloudinary, params: { folder: 'chatflow', resource_type: 'auto', allowed_formats: ['jpg','jpeg','png','gif','webp','pdf','zip'] } });
    upload = multer({ storage, limits: { fileSize: 10*1024*1024 } });
    console.log('✅ Cloudinary file uploads enabled');
  }
} catch(e) { console.log('ℹ️  Cloudinary not configured — file upload disabled'); }

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 5000;
const SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_prod';
const MONGO  = process.env.MONGO_URI  || 'mongodb://127.0.0.1:27017/chatflow';
const CLIENT = process.env.CLIENT_URL || 'http://localhost:5173';

// ── SOCKET.IO ────────────────────────────────────────────────
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── MONGOOSE MODELS ──────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username: { type:String, required:true, unique:true, trim:true, minlength:2, maxlength:20 },
  password: { type:String, required:true },
  avatar:   { type:String, default:'😊' },
}, { timestamps:true });
userSchema.pre('save', async function() { if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 10); });
const User = mongoose.model('User', userSchema);

const roomSchema = new mongoose.Schema({
  name:        { type:String, required:true, unique:true, trim:true, lowercase:true },
  description: { type:String, default:'' },
}, { timestamps:true });
const Room = mongoose.model('Room', roomSchema);

const msgSchema = new mongoose.Schema({
  room:         { type:String, required:true, index:true },
  sender:       { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  senderName:   String,
  senderAvatar: String,
  content:      { type:String, required:true, maxlength:2000 },
  type:         { type:String, enum:['text','image','file','system'], default:'text' },
  fileUrl:      String,
  fileName:     String,
  fileSize:     Number,
  fileType:     String,
  reactions:    { type:Map, of:[String], default:{} },
  seenBy:       [{ userId:String, username:String, seenAt:{ type:Date, default:Date.now } }],
}, { timestamps:true });
msgSchema.index({ content:'text' });
const Msg = mongoose.model('Msg', msgSchema);

// ── AUTH HELPERS ─────────────────────────────────────────────
const signTok  = id  => jwt.sign({ id }, SECRET, { expiresIn:'7d' });
const checkTok = t   => { try { return jwt.verify(t, SECRET); } catch { return null; } };
const authMw   = req => checkTok((req.headers.authorization||'').split(' ')[1]);

// ── REST ─────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok:true, time:new Date() }));

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, avatar='😊' } = req.body;
    if (!username?.trim() || !password) return res.status(400).json({ error:'Username and password required' });
    if (password.length < 6) return res.status(400).json({ error:'Password must be 6+ chars' });
    if (await User.findOne({ username:username.trim() })) return res.status(409).json({ error:'Username taken' });
    const user = await User.create({ username:username.trim(), password, avatar });
    res.status(201).json({ token:signTok(user._id), user:{ id:user._id, username:user.username, avatar:user.avatar } });
  } catch(e) { res.status(500).json({ error:'Server error: '+e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error:'Wrong username or password' });
    res.json({ token:signTok(user._id), user:{ id:user._id, username:user.username, avatar:user.avatar } });
  } catch(e) { res.status(500).json({ error:'Server error' }); }
});

app.get('/api/rooms', async (_, res) => {
  res.json(await Room.find().sort({ createdAt:1 }));
});

app.post('/api/rooms', async (req, res) => {
  const p = authMw(req); if (!p) return res.status(401).json({ error:'Login required' });
  try {
    const name = req.body.name?.trim().toLowerCase().replace(/\s+/g,'-');
    if (!name) return res.status(400).json({ error:'Room name required' });
    const room = await Room.create({ name, description: req.body.description||'' });
    res.status(201).json(room);
  } catch(e) {
    if (e.code===11000) return res.status(409).json({ error:'Room name already taken' });
    res.status(500).json({ error:'Server error' });
  }
});

app.get('/api/rooms/:room/messages', async (req, res) => {
  if (!authMw(req)) return res.status(401).json({ error:'Login required' });
  const msgs = await Msg.find({ room:req.params.room }).sort({ createdAt:-1 }).limit(50).lean();
  res.json(msgs.reverse());
});

app.get('/api/rooms/:room/search', async (req, res) => {
  if (!authMw(req)) return res.status(401).json({ error:'Login required' });
  const q = req.query.q?.trim();
  if (!q || q.length < 2) return res.json([]);
  const results = await Msg.find({ room:req.params.room, type:'text', content:{ $regex:q, $options:'i' } }).sort({ createdAt:-1 }).limit(30).lean();
  res.json(results.reverse());
});

// File upload (only if Cloudinary configured)
app.post('/api/upload', async (req, res) => {
  if (!authMw(req)) return res.status(401).json({ error:'Login required' });
  if (!upload) return res.status(400).json({ error:'File upload not configured. Add Cloudinary env vars.' });
  upload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error:err.message });
    if (!req.file) return res.status(400).json({ error:'No file' });
    res.json({ url:req.file.path, originalName:req.file.originalname, size:req.file.size, fileType:req.file.mimetype });
  });
});

// ── SOCKET ───────────────────────────────────────────────────
io.use((socket, next) => {
  const p = checkTok(socket.handshake.auth?.token);
  if (!p) return next(new Error('Unauthorized'));
  socket.uid = p.id;
  next();
});

const roomOnline  = {}; // roomName -> Set<socketId>
const socketUsers = {}; // socketId -> user doc

io.on('connection', async socket => {
  let user;
  try { user = await User.findById(socket.uid).select('username avatar').lean(); }
  catch { return socket.disconnect(); }
  if (!user) return socket.disconnect();
  socketUsers[socket.id] = user;

  // ── join_room ──
  socket.on('join_room', async room => {
    // leave old rooms
    for (const r of [...socket.rooms]) {
      if (r === socket.id) continue;
      socket.leave(r);
      roomOnline[r]?.delete(socket.id);
      io.to(r).emit('room_count', { room:r, count: roomOnline[r]?.size||0 });
    }
    socket.join(room);
    if (!roomOnline[room]) roomOnline[room] = new Set();
    roomOnline[room].add(socket.id);
    io.to(room).emit('room_count', { room, count: roomOnline[room].size });
    io.to(room).emit('user_joined', { username:user.username, avatar:user.avatar });
    // system message
    Msg.create({ room, sender:socket.uid, senderName:user.username, senderAvatar:user.avatar, content:`${user.username} joined`, type:'system' }).catch(()=>{});
  });

  // ── send_message ──
  socket.on('send_message', async ({ room, content, fileUrl, fileName, fileSize, fileType, msgType }) => {
    const text = content?.trim();
    if (!text && !fileUrl) return;
    if (text && text.length > 2000) return;
    try {
      const msg = await Msg.create({
        room, sender:socket.uid, senderName:user.username, senderAvatar:user.avatar,
        content: text || fileName || 'Shared a file',
        type: msgType || 'text', fileUrl, fileName, fileSize, fileType,
      });
      io.to(room).emit('new_message', {
        _id: msg._id.toString(), room,
        senderName:user.username, senderAvatar:user.avatar,
        content:msg.content, type:msg.type,
        fileUrl, fileName, fileSize, fileType,
        reactions:{}, seenBy:[],
        createdAt:msg.createdAt,
      });
    } catch(e) { console.error('send_message error:', e.message); }
  });

  // ── typing ──
  socket.on('typing_start', ({ room }) => socket.to(room).emit('typing', { username:user.username }));
  socket.on('typing_stop',  ({ room }) => socket.to(room).emit('stop_typing', { username:user.username }));

  // ── reactions ──
  const ALLOWED = ['👍','❤️','😂','😮','😢','🔥'];
  socket.on('react', async ({ msgId, emoji, room }) => {
    if (!ALLOWED.includes(emoji)) return;
    try {
      const msg = await Msg.findById(msgId);
      if (!msg) return;
      const users = msg.reactions.get(emoji) || [];
      msg.reactions.set(emoji, users.includes(user.username) ? users.filter(u=>u!==user.username) : [...users, user.username]);
      await msg.save();
      io.to(room).emit('reaction_update', { msgId, reactions:Object.fromEntries(msg.reactions) });
    } catch(e) { console.error('react error:', e.message); }
  });

  // ── read receipts ──
  socket.on('mark_read', async ({ msgIds, room }) => {
    if (!msgIds?.length) return;
    try {
      await Msg.updateMany(
        { _id:{ $in:msgIds }, room, 'seenBy.userId':{ $ne:socket.uid.toString() } },
        { $push:{ seenBy:{ userId:socket.uid.toString(), username:user.username } } }
      );
      io.to(room).emit('read_update', { msgIds, reader:{ userId:socket.uid.toString(), username:user.username } });
    } catch(e) { console.error('mark_read error:', e.message); }
  });

  // ── disconnect ──
  socket.on('disconnect', () => {
    for (const r of [...socket.rooms]) {
      if (r === socket.id) continue;
      roomOnline[r]?.delete(socket.id);
      io.to(r).emit('room_count', { room:r, count: roomOnline[r]?.size||0 });
      io.to(r).emit('user_left', { username:user.username });
    }
    delete socketUsers[socket.id];
  });
});

// ── START ────────────────────────────────────────────────────
mongoose.connect(MONGO)
  .then(async () => {
    console.log('✅ MongoDB connected');
    if (await Room.countDocuments() === 0) {
      await Room.insertMany([
        { name:'general',  description:'General chat for everyone' },
        { name:'tech',     description:'Dev talk & code help' },
        { name:'random',   description:'Anything goes!' },
      ]);
      console.log('🌱 Seeded default rooms');
    }
    server.listen(PORT, () => console.log(`🚀 Server → http://localhost:${PORT}`));
  })
  .catch(e => { console.error('MongoDB failed:', e.message); process.exit(1); });
