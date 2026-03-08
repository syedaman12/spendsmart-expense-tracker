// ================================================================
// ChatFlow — App.jsx
// All-in-one React file. Copy to src/App.jsx in a Vite project.
// npm install socket.io-client  (only extra dependency needed)
// ================================================================
import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";

const SERVER = import.meta.env.VITE_SERVER_URL || "http://localhost:5000";
const AVATARS  = ["😊","😎","🤓","🥳","😺","🦊","🐼","🦁","🐙","🦋","🤖","👾","🧑‍💻","🎃","🌟"];
const REACTIONS = ["👍","❤️","😂","😮","😢","🔥"];

// ── helpers ──────────────────────────────────────────────────
async function api(path, method = "GET", body = null, token = null) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: { "Content-Type":"application/json", ...(token ? { Authorization:`Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
const fmtTime = d => new Date(d).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });

// ================================================================
// AUTH SCREEN
// ================================================================
function AuthScreen({ onLogin }) {
  const [mode, setMode]     = useState("login");
  const [username, setUser] = useState("");
  const [password, setPass] = useState("");
  const [avatar, setAvatar] = useState("😊");
  const [error, setError]   = useState("");
  const [loading, setLoad]  = useState(false);

  const submit = async () => {
    setError("");
    if (!username.trim() || !password) return setError("Username and password required");
    if (password.length < 6) return setError("Password must be 6+ characters");
    setLoad(true);
    try {
      const endpoint = mode === "login" ? "/api/login" : "/api/register";
      const data = await api(endpoint, "POST", { username: username.trim(), password, avatar });
      localStorage.setItem("cf_token", data.token);
      localStorage.setItem("cf_user", JSON.stringify(data.user));
      onLogin(data.token, data.user);
    } catch(e) { setError(e.message); }
    finally { setLoad(false); }
  };

  return (
    <div style={C.authWrap}>
      <div style={C.authCard}>
        <div style={C.authLogo}>💬</div>
        <h1 style={C.authTitle}>ChatFlow</h1>
        <p style={C.authSub}>Real-time chat app</p>

        <div style={C.tabs}>
          {["login","register"].map(m => (
            <button key={m} style={{ ...C.tab, ...(mode===m?C.tabOn:{}) }}
              onClick={() => { setMode(m); setError(""); }}>
              {m === "login" ? "Sign In" : "Register"}
            </button>
          ))}
        </div>

        {mode === "register" && (
          <div style={{ marginBottom:16 }}>
            <p style={C.label}>Pick your avatar</p>
            <div style={C.avatarGrid}>
              {AVATARS.map(a => (
                <button key={a} style={{ ...C.avatarBtn, ...(avatar===a?C.avatarOn:{}) }}
                  onClick={() => setAvatar(a)}>{a}</button>
              ))}
            </div>
          </div>
        )}

        <input style={C.inp} placeholder="Username" value={username}
          onChange={e => setUser(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()} autoFocus/>
        <input style={C.inp} type="password" placeholder="Password (min 6 chars)" value={password}
          onChange={e => setPass(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}/>

        {error && <div style={C.authErr}>{error}</div>}

        <button style={{ ...C.btnPrimary, width:"100%", padding:13, opacity: loading?0.7:1 }}
          onClick={submit} disabled={loading}>
          {loading ? "Please wait..." : mode==="login" ? "Sign In" : "Create Account"}
        </button>
      </div>
    </div>
  );
}

// ================================================================
// CHAT APP
// ================================================================
function ChatApp({ token, user, onLogout }) {
  // core
  const [socket, setSocket]   = useState(null);
  const [connected, setConn]  = useState(false);
  const [rooms, setRooms]     = useState([]);
  const [activeRoom, setRoom] = useState(null);
  const [messages, setMsgs]   = useState([]);
  const [input, setInput]     = useState("");
  const [online, setOnline]   = useState(0);
  const [typing, setTyping]   = useState([]);
  const [sideOpen, setSide]   = useState(true);

  // new room
  const [newRoom, setNewRoom]     = useState("");
  const [showNew, setShowNew]     = useState(false);
  const [newRoomErr, setNewRoomErr] = useState("");

  // reactions
  const [reactions, setReacts] = useState({}); // { msgId: { emoji:[names] } }
  const [hovMsg, setHovMsg]    = useState(null);

  // read receipts
  const [seenMap, setSeenMap]  = useState({}); // { msgId: [{userId,username}] }

  // file upload
  const [uploading, setUpping] = useState(false);
  const fileRef                = useRef(null);

  // search
  const [srchOpen, setSrchOpen]   = useState(false);
  const [srchQ, setSrchQ]         = useState("");
  const [srchRes, setSrchRes]     = useState([]);
  const [srching, setSrching]     = useState(false);
  const srchTimer                 = useRef(null);

  const endRef     = useRef(null);
  const typTimer   = useRef(null);
  const isTyping   = useRef(false);

  // ── load rooms ──
  useEffect(() => { api("/api/rooms").then(setRooms).catch(console.error); }, []);

  // ── socket connection ──
  useEffect(() => {
    const s = io(SERVER, { auth:{ token }, reconnectionAttempts:5 });
    s.on("connect",         () => { setConn(true);  console.log("✅ Socket connected"); });
    s.on("disconnect",      () => { setConn(false); console.log("❌ Socket disconnected"); });
    s.on("connect_error",   e  => { console.error("Socket error:", e.message); });
    setSocket(s);
    return () => s.disconnect();
  }, [token]);

  // ── socket events ──
  useEffect(() => {
    if (!socket) return;
    const on = (ev, fn) => { socket.on(ev, fn); return () => socket.off(ev, fn); };

    const offs = [
      on("new_message",    msg  => setMsgs(p => [...p, msg])),
      on("room_count",     ({ count }) => setOnline(count)),
      on("user_joined",    () => {}),
      on("user_left",      () => {}),
      on("typing",         ({ username }) => setTyping(p => [...new Set([...p, username])])),
      on("stop_typing",    ({ username }) => setTyping(p => p.filter(u => u !== username))),
      on("reaction_update",({ msgId, reactions:r }) => setReacts(p => ({ ...p, [msgId]: r }))),
      on("read_update",    ({ msgIds, reader }) => setSeenMap(p => {
        const u = { ...p };
        msgIds.forEach(id => { const ex = u[id]||[]; if (!ex.find(s=>s.userId===reader.userId)) u[id]=[...ex,reader]; });
        return u;
      })),
    ];
    return () => offs.forEach(f => f());
  }, [socket]);

  // ── auto scroll ──
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, typing]);

  // ── mark read ──
  useEffect(() => {
    if (!activeRoom || !socket) return;
    const unread = messages
      .filter(m => m.type !== "system" && m.senderName !== user.username && m._id)
      .filter(m => !(seenMap[m._id]||[]).find(s => s.username === user.username))
      .map(m => m._id);
    if (unread.length) socket.emit("mark_read", { msgIds:unread, room:activeRoom.name });
  }, [messages, activeRoom]);

  // ── join room ──
  const joinRoom = useCallback(async (room) => {
    setRoom(room); setMsgs([]); setTyping([]); setSrchOpen(false);
    setSide(window.innerWidth > 640 ? true : false);
    try {
      const hist = await api(`/api/rooms/${room.name}/messages`, "GET", null, token);
      setMsgs(hist);
      const rMap = {}, sMap = {};
      hist.forEach(m => {
        if (m.reactions) rMap[m._id] = m.reactions;
        if (m.seenBy?.length) sMap[m._id] = m.seenBy;
      });
      setReacts(rMap); setSeenMap(sMap);
    } catch(e) { console.error("Load history failed:", e.message); }
    socket?.emit("join_room", room.name);
  }, [socket, token]);

  // ── send message ──
  const send = () => {
    if (!input.trim() || !activeRoom || !socket) return;
    socket.emit("send_message", { room:activeRoom.name, content:input.trim() });
    setInput(""); stopTyp();
  };

  const handleInput = e => {
    setInput(e.target.value);
    if (!activeRoom || !socket) return;
    if (!isTyping.current) { isTyping.current=true; socket.emit("typing_start",{ room:activeRoom.name }); }
    clearTimeout(typTimer.current);
    typTimer.current = setTimeout(stopTyp, 1500);
  };
  const stopTyp = () => { if (isTyping.current) { isTyping.current=false; socket?.emit("typing_stop",{ room:activeRoom?.name }); } };

  // ── reactions ──
  const sendReact = (msgId, emoji) => socket?.emit("react", { msgId, emoji, room:activeRoom.name });

  // ── file upload ──
  const uploadFile = async file => {
    if (file.size > 10*1024*1024) { alert("Max 10MB"); return; }
    setUpping(true);
    try {
      const form = new FormData(); form.append("file", file);
      const res = await fetch(`${SERVER}/api/upload`, { method:"POST", headers:{ Authorization:`Bearer ${token}` }, body:form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      socket?.emit("send_message", {
        room:activeRoom.name,
        content: file.type.startsWith("image/") ? "📷 Image" : `📎 ${data.originalName}`,
        fileUrl:data.url, fileName:data.originalName, fileSize:data.size, fileType:data.fileType,
        msgType: file.type.startsWith("image/") ? "image" : "file",
      });
    } catch(e) { alert("Upload failed: " + e.message + "\n\nMake sure Cloudinary is configured in server .env"); }
    finally { setUpping(false); }
  };

  const handlePaste = e => {
    for (const item of e.clipboardData?.items||[]) {
      if (item.type.startsWith("image/")) { const f=item.getAsFile(); if(f){e.preventDefault();uploadFile(f);} }
    }
  };

  // ── search ──
  const doSearch = async q => {
    if (!q.trim() || q.length<2 || !activeRoom) { setSrchRes([]); return; }
    setSrching(true);
    try { setSrchRes(await api(`/api/rooms/${activeRoom.name}/search?q=${encodeURIComponent(q)}`, "GET", null, token)); }
    catch(e) { console.error(e); }
    finally { setSrching(false); }
  };
  const handleSearch = e => {
    const q = e.target.value; setSrchQ(q);
    clearTimeout(srchTimer.current); srchTimer.current = setTimeout(() => doSearch(q), 400);
  };
  const jumpTo = id => {
    const el = document.querySelector(`[data-mid="${id}"]`);
    if (el) { el.scrollIntoView({ behavior:"smooth", block:"center" }); el.style.outline="2px solid #6366f1"; setTimeout(()=>el.style.outline="",2000); }
    setSrchOpen(false); setSrchQ(""); setSrchRes([]);
  };
  const hilite = (text, q) => {
    if (!q) return <span>{text}</span>;
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")})`, "gi"));
    return <span>{parts.map((p,i) => p.toLowerCase()===q.toLowerCase() ? <mark key={i} style={{ background:"#fde68a",color:"#000",borderRadius:2,padding:"0 2px" }}>{p}</mark> : p)}</span>;
  };

  // ── create room ──
  const createRoom = async () => {
    setNewRoomErr("");
    if (!newRoom.trim()) return;
    try {
      const room = await api("/api/rooms","POST",{ name:newRoom.trim() },token);
      setRooms(p=>[...p,room]); setNewRoom(""); setShowNew(false); joinRoom(room);
    } catch(e) { setNewRoomErr(e.message); }
  };

  // ── render one message ──
  const renderMsg = (msg, i) => {
    const isMe     = msg.senderName === user.username;
    const isSys    = msg.type === "system";
    const msgReact = reactions[msg._id] || (typeof msg.reactions==="object"&&!Array.isArray(msg.reactions) ? msg.reactions : {});
    const msgSeen  = (seenMap[msg._id] || msg.seenBy || []).filter(s => s.username !== msg.senderName);

    if (isSys) return <div key={msg._id||i} style={C.sysMsg}>{msg.content}</div>;

    if (msg.type === "image") return (
      <div key={msg._id||i} data-mid={msg._id} style={{ ...C.row, ...(isMe?C.rowMe:{}) }}>
        {!isMe && <span style={C.ava}>{msg.senderAvatar}</span>}
        <div style={{ maxWidth:"70%" }}>
          {!isMe && <div style={C.sname}>{msg.senderName}</div>}
          <a href={msg.fileUrl} target="_blank" rel="noreferrer">
            <img src={msg.fileUrl} alt="img" style={{ maxWidth:220, borderRadius:12, display:"block", border:"1px solid #334155" }}/>
          </a>
          <div style={C.time}>{fmtTime(msg.createdAt)}</div>
        </div>
        {isMe && <span style={C.ava}>{user.avatar}</span>}
      </div>
    );

    if (msg.type === "file") return (
      <div key={msg._id||i} data-mid={msg._id} style={{ ...C.row, ...(isMe?C.rowMe:{}) }}>
        {!isMe && <span style={C.ava}>{msg.senderAvatar}</span>}
        <div style={{ maxWidth:"70%" }}>
          {!isMe && <div style={C.sname}>{msg.senderName}</div>}
          <a href={msg.fileUrl} target="_blank" download={msg.fileName} rel="noreferrer" style={C.fileCard}>
            <span style={{ fontSize:26 }}>📎</span>
            <div><div style={{ fontSize:13,fontWeight:600 }}>{msg.fileName}</div><div style={{ fontSize:11,color:"#94a3b8" }}>{((msg.fileSize||0)/1024/1024).toFixed(2)} MB</div></div>
          </a>
          <div style={C.time}>{fmtTime(msg.createdAt)}</div>
        </div>
        {isMe && <span style={C.ava}>{user.avatar}</span>}
      </div>
    );

    return (
      <div key={msg._id||i} data-mid={msg._id} style={{ ...C.row, ...(isMe?C.rowMe:{}), padding:"2px 4px", borderRadius:8, transition:"background .5s" }}>
        {!isMe && <span style={C.ava}>{msg.senderAvatar}</span>}
        <div style={{ maxWidth:"72%" }}>
          {!isMe && <div style={C.sname}>{msg.senderName}</div>}

          {/* Bubble + hover picker */}
          <div style={{ position:"relative" }}
            onMouseEnter={() => msg._id && setHovMsg(msg._id)}
            onMouseLeave={() => setHovMsg(null)}>
            <div style={{ ...C.bubble, ...(isMe?C.bubbleMe:{}) }}>{msg.content}</div>
            {hovMsg === msg._id && msg._id && (
              <div style={{ ...C.picker, ...(isMe?{right:"100%",marginRight:6}:{left:"100%",marginLeft:6}) }}>
                {REACTIONS.map(e => (
                  <button key={e} style={C.pickBtn}
                    onMouseEnter={ev=>ev.currentTarget.style.transform="scale(1.3)"}
                    onMouseLeave={ev=>ev.currentTarget.style.transform="scale(1)"}
                    onClick={()=>sendReact(msg._id,e)}>{e}</button>
                ))}
              </div>
            )}
          </div>

          {/* Reaction badges */}
          {Object.entries(msgReact).filter(([,u])=>u?.length>0).length > 0 && (
            <div style={{ display:"flex",flexWrap:"wrap",gap:4,marginTop:4,justifyContent:isMe?"flex-end":"flex-start" }}>
              {Object.entries(msgReact).filter(([,u])=>u?.length>0).map(([emoji,users]) => (
                <button key={emoji} onClick={()=>sendReact(msg._id,emoji)}
                  title={Array.isArray(users)?users.join(", "):""}
                  style={{ ...C.reactBadge, ...(Array.isArray(users)&&users.includes(user.username)?C.reactBadgeMe:{}) }}>
                  {emoji} {Array.isArray(users)?users.length:0}
                </button>
              ))}
            </div>
          )}

          {/* Time + Read receipt */}
          <div style={{ display:"flex",alignItems:"center",gap:4,marginTop:2,justifyContent:isMe?"flex-end":"flex-start" }}>
            <span style={C.time}>{fmtTime(msg.createdAt)}</span>
            {isMe && msg._id && (
              <span style={{ fontSize:10, color: msgSeen.length>0?"#6366f1":"#475569" }}
                title={msgSeen.length>0?`Seen by: ${msgSeen.map(s=>s.username).join(", ")}`:"Sent"}>
                {msgSeen.length>0?"✓✓":"✓"}
              </span>
            )}
          </div>
        </div>
        {isMe && <span style={C.ava}>{user.avatar}</span>}
      </div>
    );
  };

  return (
    <div style={C.app}>
      {/* ── Sidebar ── */}
      <div style={{ ...C.sidebar, ...(sideOpen?{}:{width:0,overflow:"hidden"}) }}>
        <div style={C.sHead}>
          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
            <span style={{ fontSize:22 }}>💬</span>
            <span style={{ color:"#fff",fontWeight:800,fontSize:17 }}>ChatFlow</span>
          </div>
          <button style={C.iconBtn} onClick={onLogout} title="Logout">🚪</button>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:8,padding:"10px 16px 12px",borderBottom:"1px solid #334155" }}>
          <span style={{ fontSize:22 }}>{user.avatar}</span>
          <span style={{ color:"#f1f5f9",fontWeight:600,fontSize:14,flex:1 }}>{user.username}</span>
          <span style={{ width:8,height:8,borderRadius:"50%",background: connected?"#22c55e":"#ef4444",display:"inline-block" }} title={connected?"Connected":"Disconnected"}/>
        </div>
        <div style={{ fontSize:10,fontWeight:700,letterSpacing:2,color:"#64748b",padding:"10px 16px 6px" }}>ROOMS</div>
        <div style={{ flex:1,overflowY:"auto" }}>
          {rooms.map(r => (
            <button key={r._id} style={{ ...C.roomBtn, ...(activeRoom?._id===r._id?C.roomBtnOn:{}) }} onClick={()=>joinRoom(r)}>
              <span style={{ color:"#6366f1",fontWeight:700,fontSize:16,lineHeight:1 }}>#</span>
              <div style={{ textAlign:"left" }}>
                <div style={{ color:"#e2e8f0",fontSize:14,fontWeight:600 }}>{r.name}</div>
                {r.description && <div style={{ color:"#64748b",fontSize:11 }}>{r.description}</div>}
              </div>
            </button>
          ))}
        </div>
        {showNew ? (
          <div style={{ padding:"0 12px 14px" }}>
            <input autoFocus value={newRoom} placeholder="room-name"
              onChange={e=>setNewRoom(e.target.value.toLowerCase().replace(/\s+/g,"-"))}
              onKeyDown={e=>e.key==="Enter"&&createRoom()}
              style={{ width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid #4f46e5",background:"#0f172a",color:"#f1f5f9",fontSize:13,marginBottom:6,boxSizing:"border-box",outline:"none",fontFamily:"inherit" }}/>
            {newRoomErr && <p style={{ color:"#ef4444",fontSize:11,marginBottom:4 }}>{newRoomErr}</p>}
            <div style={{ display:"flex",gap:6 }}>
              <button onClick={createRoom} style={C.btnSm}>Create</button>
              <button onClick={()=>{setShowNew(false);setNewRoomErr("");}} style={{ ...C.btnSm,background:"#374151" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={()=>setShowNew(true)} style={C.addRoomBtn}>+ New Room</button>
        )}
      </div>

      {/* ── Chat area ── */}
      <div style={C.chatArea}>
        {/* Header */}
        <div style={C.chatHead}>
          <button style={C.iconBtn} onClick={()=>setSide(!sideOpen)}>☰</button>
          {activeRoom ? <>
            <div>
              <span style={{ color:"#f1f5f9",fontWeight:700,fontSize:16 }}># {activeRoom.name}</span>
              {activeRoom.description && <span style={{ color:"#64748b",fontSize:13 }}> — {activeRoom.description}</span>}
            </div>
            <div style={{ marginLeft:"auto",display:"flex",alignItems:"center",gap:12 }}>
              <span style={{ color:"#22c55e",fontSize:12,fontWeight:600 }}>🟢 {online}</span>
              <button style={{ ...C.iconBtn, color:srchOpen?"#6366f1":"#94a3b8" }}
                onClick={()=>{ setSrchOpen(!srchOpen); setSrchQ(""); setSrchRes([]); }}>🔍</button>
            </div>
          </> : <span style={{ color:"#64748b" }}>← Select a room to start chatting</span>}
        </div>

        {/* Search panel */}
        {srchOpen && activeRoom && (
          <div style={{ background:"#1e293b",borderBottom:"1px solid #334155",padding:"12px 18px" }}>
            <div style={{ display:"flex",gap:8,alignItems:"center",marginBottom:8 }}>
              <input autoFocus value={srchQ} onChange={handleSearch}
                placeholder={`Search in #${activeRoom.name}...`}
                style={{ flex:1,padding:"9px 13px",borderRadius:10,border:"1px solid #334155",background:"#0f172a",color:"#f1f5f9",fontSize:14,outline:"none",fontFamily:"inherit" }}/>
              <button style={C.iconBtn} onClick={()=>{setSrchOpen(false);setSrchQ("");setSrchRes([]);}}>✕</button>
            </div>
            {srching && <p style={{ color:"#64748b",fontSize:13 }}>Searching...</p>}
            {!srching && srchQ.length>=2 && srchRes.length===0 && (
              <p style={{ color:"#64748b",fontSize:13 }}>No results for "{srchQ}"</p>
            )}
            {srchRes.length > 0 && (
              <div style={{ maxHeight:250,overflowY:"auto",borderRadius:10,border:"1px solid #334155",background:"#0f172a" }}>
                {srchRes.map((m,i) => (
                  <div key={m._id} onClick={()=>jumpTo(m._id)}
                    style={{ padding:"10px 14px",cursor:"pointer",borderBottom:i<srchRes.length-1?"1px solid #1e293b":"none" }}
                    onMouseEnter={e=>e.currentTarget.style.background="#1e293b"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:3 }}>
                      <span style={{ color:"#6366f1",fontSize:12,fontWeight:700 }}>{m.senderAvatar} {m.senderName}</span>
                      <span style={{ color:"#475569",fontSize:11 }}>{new Date(m.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div style={{ color:"#94a3b8",fontSize:13,lineHeight:1.4 }}>{hilite(m.content,srchQ)}</div>
                  </div>
                ))}
                <p style={{ textAlign:"center",color:"#475569",fontSize:11,padding:"6px 0" }}>
                  {srchRes.length} result{srchRes.length!==1?"s":""} — click to jump
                </p>
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        <div style={C.msgs}>
          {!activeRoom && (
            <div style={{ margin:"auto",textAlign:"center",color:"#64748b" }}>
              <div style={{ fontSize:52,marginBottom:12 }}>💬</div>
              <h2 style={{ color:"#f1f5f9",marginBottom:8 }}>Welcome, {user.username}!</h2>
              <p>Select a room from the sidebar to start chatting.</p>
            </div>
          )}
          {messages.map(renderMsg)}
          {typing.length>0 && (
            <div style={{ color:"#94a3b8",fontSize:12,fontStyle:"italic",padding:"2px 0" }}>
              {typing.join(", ")} {typing.length===1?"is":"are"} typing...
            </div>
          )}
          <div ref={endRef}/>
        </div>

        {/* Input */}
        {activeRoom && (
          <div style={C.inputRow}>
            <input ref={fileRef} type="file" style={{ display:"none" }}
              accept="image/*,.pdf,.doc,.docx,.zip"
              onChange={e=>{if(e.target.files[0]){uploadFile(e.target.files[0]);e.target.value="";}}}/>
            <button style={{ ...C.attachBtn,opacity:uploading?0.5:1 }}
              disabled={uploading} onClick={()=>fileRef.current?.click()}
              title="Attach file (or paste image)">
              {uploading?"⏳":"📎"}
            </button>
            <input style={C.msgInp} value={input} onChange={handleInput} onPaste={handlePaste}
              placeholder={`Message #${activeRoom.name}`}
              onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();} }}
              maxLength={2000}/>
            <button style={{ ...C.sendBtn,opacity:input.trim()?1:0.4 }}
              disabled={!input.trim()} onClick={send}>➤</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ================================================================
// STYLES
// ================================================================
const C = {
  // Auth
  authWrap:  { minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0f172a",fontFamily:"system-ui,sans-serif",padding:16 },
  authCard:  { background:"#1e293b",border:"1px solid #334155",borderRadius:16,padding:"36px 28px",width:"100%",maxWidth:360,boxShadow:"0 20px 60px rgba(0,0,0,0.5)" },
  authLogo:  { fontSize:48,textAlign:"center",marginBottom:4 },
  authTitle: { color:"#fff",fontSize:26,fontWeight:800,textAlign:"center",marginBottom:4,letterSpacing:"-0.5px" },
  authSub:   { color:"#64748b",textAlign:"center",marginBottom:22,fontSize:14 },
  tabs:      { display:"flex",background:"#0f172a",borderRadius:10,padding:4,marginBottom:20 },
  tab:       { flex:1,padding:"8px 0",border:"none",background:"none",color:"#94a3b8",cursor:"pointer",borderRadius:8,fontWeight:600,fontSize:13,fontFamily:"inherit" },
  tabOn:     { background:"#6366f1",color:"#fff" },
  label:     { color:"#94a3b8",fontSize:11,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:8 },
  avatarGrid:{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:4 },
  avatarBtn: { fontSize:22,padding:6,border:"2px solid transparent",borderRadius:8,background:"#0f172a",cursor:"pointer",fontFamily:"inherit" },
  avatarOn:  { border:"2px solid #6366f1",background:"#1e1b4b" },
  inp:       { width:"100%",padding:"11px 13px",borderRadius:10,border:"1px solid #334155",background:"#0f172a",color:"#f1f5f9",fontSize:14,marginBottom:10,outline:"none",fontFamily:"inherit",boxSizing:"border-box",display:"block" },
  authErr:   { color:"#ef4444",fontSize:13,marginBottom:10,textAlign:"center",background:"rgba(239,68,68,0.1)",padding:"8px 12px",borderRadius:8 },
  btnPrimary:{ background:"#6366f1",color:"#fff",border:"none",borderRadius:10,fontWeight:700,fontSize:15,cursor:"pointer",fontFamily:"inherit" },
  // App
  app:       { display:"flex",height:"100vh",background:"#0f172a",fontFamily:"system-ui,sans-serif",overflow:"hidden" },
  sidebar:   { width:256,background:"#1e293b",borderRight:"1px solid #334155",display:"flex",flexDirection:"column",flexShrink:0,transition:"width 0.25s" },
  sHead:     { display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px 10px" },
  iconBtn:   { background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#94a3b8",padding:"4px 6px",borderRadius:6,fontFamily:"inherit" },
  roomBtn:   { width:"100%",textAlign:"left",background:"none",border:"none",cursor:"pointer",padding:"8px 16px",display:"flex",alignItems:"flex-start",gap:8,fontFamily:"inherit" },
  roomBtnOn: { background:"#334155" },
  addRoomBtn:{ margin:"10px 12px",padding:"8px 12px",background:"rgba(99,102,241,0.12)",color:"#818cf8",border:"1px dashed #4f46e5",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit" },
  btnSm:     { flex:1,padding:"7px 0",background:"#6366f1",color:"#fff",border:"none",borderRadius:7,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit" },
  chatArea:  { flex:1,display:"flex",flexDirection:"column",overflow:"hidden" },
  chatHead:  { display:"flex",alignItems:"center",gap:10,padding:"13px 18px",borderBottom:"1px solid #334155",background:"#1e293b",flexShrink:0 },
  msgs:      { flex:1,overflowY:"auto",padding:"16px 18px",display:"flex",flexDirection:"column",gap:2 },
  sysMsg:    { textAlign:"center",color:"#475569",fontSize:12,padding:"4px 0",fontStyle:"italic" },
  row:       { display:"flex",alignItems:"flex-end",gap:8,marginBottom:4 },
  rowMe:     { flexDirection:"row-reverse" },
  ava:       { fontSize:24,flexShrink:0,lineHeight:1 },
  sname:     { color:"#94a3b8",fontSize:11,fontWeight:600,marginBottom:3,paddingLeft:2 },
  bubble:    { background:"#1e293b",color:"#e2e8f0",padding:"10px 13px",borderRadius:"16px 16px 16px 4px",fontSize:14,lineHeight:1.5,border:"1px solid #334155",wordBreak:"break-word" },
  bubbleMe:  { background:"#6366f1",color:"#fff",borderRadius:"16px 16px 4px 16px",border:"none" },
  time:      { color:"#475569",fontSize:10 },
  picker:    { position:"absolute",top:0,background:"#0f172a",border:"1px solid #334155",borderRadius:20,padding:"4px 6px",display:"flex",gap:2,zIndex:10,boxShadow:"0 4px 20px rgba(0,0,0,0.4)",alignItems:"center" },
  pickBtn:   { background:"none",border:"none",cursor:"pointer",fontSize:17,padding:"2px 4px",borderRadius:6,transition:"transform 0.1s",fontFamily:"inherit" },
  reactBadge:{ background:"#1e293b",border:"1px solid #334155",borderRadius:12,padding:"2px 8px",fontSize:12,cursor:"pointer",color:"#e2e8f0",fontFamily:"inherit" },
  reactBadgeMe:{ background:"rgba(99,102,241,0.2)",border:"1px solid #6366f1" },
  fileCard:  { display:"flex",alignItems:"center",gap:10,background:"#1e293b",border:"1px solid #334155",borderRadius:12,padding:"10px 13px",color:"#e2e8f0",textDecoration:"none" },
  inputRow:  { display:"flex",gap:8,padding:"14px 18px",borderTop:"1px solid #334155",background:"#1e293b",alignItems:"center",flexShrink:0 },
  attachBtn: { padding:"10px 13px",background:"#0f172a",border:"1px solid #334155",borderRadius:11,cursor:"pointer",fontSize:17,fontFamily:"inherit" },
  msgInp:    { flex:1,padding:"11px 14px",borderRadius:11,border:"1px solid #334155",background:"#0f172a",color:"#f1f5f9",fontSize:14,outline:"none",fontFamily:"inherit" },
  sendBtn:   { padding:"11px 16px",background:"#6366f1",color:"#fff",border:"none",borderRadius:11,cursor:"pointer",fontSize:17,fontWeight:700,fontFamily:"inherit" },
};

// ================================================================
// ROOT
// ================================================================
export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("cf_token"));
  const [user, setUser]   = useState(() => { try { return JSON.parse(localStorage.getItem("cf_user")); } catch { return null; } });

  const login  = (t, u) => { setToken(t); setUser(u); };
  const logout = () => { localStorage.removeItem("cf_token"); localStorage.removeItem("cf_user"); setToken(null); setUser(null); };

  if (!token || !user) return <AuthScreen onLogin={login}/>;
  return <ChatApp token={token} user={user} onLogout={logout}/>;
}
