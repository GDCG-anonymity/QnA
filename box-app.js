const EMAIL_DOMAIN = "user.local";

firebase.initializeApp(window.firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const el = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const boxId = params.get("id");

let isAdmin = false;
let boxData = null;
let cachedQuestions = [];

/* ===== 보안: DB/URL에서 온 값 검증 헬퍼 ===== */
const BOX_ID_RE = /^[A-Za-z0-9_-]{10,128}$/;

function safeHttpUrl(u) {
  if (typeof u !== "string" || u.length > 500) return "";
  try {
    const url = new URL(u.trim());
    return (url.protocol === "https:" || url.protocol === "http:") ? url.href : "";
  } catch (e) { return ""; }
}
function safeImg(u) {
  if (typeof u !== "string" || u.length > 1500000) return "";
  return /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+\/=]+$/.test(u) ? u : "";
}
function safeAudio(u) {
  if (typeof u !== "string" || u.length > 600000) return "";
  return /^data:audio\/[A-Za-z0-9.+-]+(;[A-Za-z0-9=.+-]+)*;base64,[A-Za-z0-9+\/=]+$/.test(u) ? u : "";
}
function cssUrl(u) {
  const v = safeImg(u);
  return v ? `url("${v}")` : "none";
}
function normalizeHttpUrl(raw) {
  const t = (raw || "").trim();
  if (!t) return "";
  return safeHttpUrl(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : "https://" + t);
}

/* ===== 할로윈 이벤트 (10/28 ~ 11/1, 한국 시간 기준) ===== */
const HW_PREVIEW = params.get("hw") === "1"; // 미리보기용 (?id=...&hw=1) - 내 화면에서만 적용
function hwBounds() {
  const y = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
  return {
    start: Date.parse(`${y}-10-28T00:00:00+09:00`),
    end: Date.parse(`${y}-11-02T00:00:00+09:00`),
  };
}
function isHalloweenWindow() {
  if (HW_PREVIEW) return true;
  const { start, end } = hwBounds();
  const now = Date.now();
  return now >= start && now < end;
}
/* "cute"(할로윈) | "horror"(어탐기) | "off"(끔) */
function halloweenMode(box) {
  if (!box || !isHalloweenWindow()) return "off";
  const m = box.halloweenMode || (box.halloweenOn === true ? "cute" : "off");
  return (m === "cute" || m === "horror") ? m : "off";
}
function halloweenActive(box) { return halloweenMode(box) !== "off"; }

const DEFAULT_PLACEHOLDER = "익명 메시지를 입력하세요";
const DEFAULT_EMPTY = "아직 아무도 흥미로운 걸 안 물어봤군요.";
/* 문구는 여기서만 바꾸면 돼요 */
const HW_TEXT = {
  cute:   { placeholder: "Trick or Treat. 노스텔지어 사탕이 생각나는 하루에요  🎃", empty: DEFAULT_EMPTY },
  horror: {
    placeholder: DEFAULT_PLACEHOLDER,
    empty: "아직 아무도 오지 않았어요... 탐사가 끝나지 않았나 봐요.",
    tabAway: "이름님이 기다리신다",                 // 다른 탭으로 가 있을 때 탭 제목
    statusAlt: "어둠탐사기록에 한 줄 적히는 중...",   // 상태 줄이 잠깐 바뀌는 문구
    metaAlt: "오전 3:33",                            // 시간 표시가 잠깐 바뀌는 값 (임시 문구)
    whispers: [                                      // 화면에 흐릿하게 떠올랐다 사라지는 문장
      "이 세상은 이름님의 것.",
      "오로지 이름님의 의지와 선택만이 의미가 있다.",
      "죽더라도 이름님에게서 도망칠 수 없다.",
      "영원한 해방이 다가온다",
    ],
  },
};
const HALLOWEEN_FLOATERS = ["🦇", "👻", "🎃", "🦇", "👻", "🕯️", "🦇"];

/* 사탕 = 이벤트 기간에 달린 질문 중 답변된 개수 (질문이 달린 날짜 기준) */
function candyCount() {
  const { start, end } = hwBounds();
  return cachedQuestions.filter((q) => {
    if (!q.answer) return false;
    if (HW_PREVIEW) return true;
    const t = q.createdAt && q.createdAt.toMillis ? q.createdAt.toMillis() : null;
    return t !== null && t >= start && t < end;
  }).length;
}

function showCandyPop() {
  let pop = document.getElementById("hwCandyPop");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "hwCandyPop";
    document.body.appendChild(pop);
  }
  pop.textContent = `🍬 ${candyCount()}`;
  const r = el("hwCandyBtn").getBoundingClientRect();
  pop.style.left = (r.left + r.width / 2) + "px";
  pop.style.top = (r.bottom + 8) + "px";
  pop.classList.add("show");
  clearTimeout(pop._t);
  pop._t = setTimeout(() => pop.classList.remove("show"), 2600);
  const btn = el("hwCandyBtn");
  btn.classList.remove("pop");
  void btn.offsetWidth;
  btn.classList.add("pop");
}

function renderHalloweenLayer(mode) {
  const root = document.documentElement;
  root.classList.toggle("halloween", mode !== "off");
  root.classList.toggle("hw-cute", mode === "cute");
  root.classList.toggle("hw-horror", mode === "horror");
  let layer = document.getElementById("halloweenLayer");
  if (mode === "off") { if (layer) layer.remove(); return; }
  if (layer && layer.dataset.mode === mode) return;
  if (layer) layer.remove();
  layer = document.createElement("div");
  layer.id = "halloweenLayer";
  layer.dataset.mode = mode;
  layer.setAttribute("aria-hidden", "true");
  if (mode === "cute") {
    ["tl", "tr"].forEach((pos) => {
      const web = document.createElement("span");
      web.className = "hw-web hw-web-" + pos;
      web.textContent = "🕸️";
      layer.appendChild(web);
    });
    HALLOWEEN_FLOATERS.forEach((emoji, i) => {
      const f = document.createElement("span");
      f.className = "hw-floater";
      f.textContent = emoji;
      f.style.left = (8 + i * 13) + "%";
      f.style.fontSize = (20 + (i % 3) * 8) + "px";
      f.style.animationDuration = (14 + (i * 3) % 9) + "s";
      f.style.animationDelay = (-i * 2.3) + "s";
      layer.appendChild(f);
    });
  } else {
    const v = document.createElement("div");
    v.className = "hw-vignette";
    layer.appendChild(v);
  }
  document.body.appendChild(layer);
}

document.addEventListener("click", (e) => {
  if (e.target.closest && e.target.closest("#hwCandyBtn")) showCandyPop();
});

/* ===== 어탐기 이스터에그 (아주 가끔, 한 번에 하나) ===== */
const GLITCH_FORCE = params.get("glitch") === "1"; // 테스트용: 동작 줄이기 무시, 2초마다 발생
function hauntReduced() {
  return !GLITCH_FORCE && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function hauntEyes() {
  const layer = document.getElementById("halloweenLayer");
  if (!layer) return;
  const e = document.createElement("div");
  e.className = "hw-eyes";
  e.style.left = (6 + Math.random() * 80) + "%";
  e.style.top = (14 + Math.random() * 66) + "%";
  e.appendChild(document.createElement("span"));
  e.appendChild(document.createElement("span"));
  layer.appendChild(e);
  setTimeout(() => e.remove(), 4300);
}
function hauntWhisper() {
  const layer = document.getElementById("halloweenLayer");
  const list = HW_TEXT.horror.whispers;
  if (!layer || !list || !list.length) return;
  const w = document.createElement("div");
  w.className = "hw-whisper";
  w.textContent = list[Math.floor(Math.random() * list.length)];
  w.style.top = (18 + Math.random() * 58) + "%";
  w.style.left = (50 + (Math.random() - 0.5) * 12) + "%";
  layer.appendChild(w);
  setTimeout(() => w.remove(), 6200);
}
function hauntStatus() {
  const n = document.getElementById("statusLine");
  if (!n || n.dataset.alt) return;
  const orig = n.textContent;
  const alt = HW_TEXT.horror.statusAlt;
  n.dataset.alt = "1";
  n.textContent = alt;
  setTimeout(() => {
    if (n.textContent === alt) n.textContent = orig;
    delete n.dataset.alt;
  }, 1500);
}
function hauntTime() {
  const feed = document.getElementById("chatFeed");
  if (!feed) return;
  const fr = feed.getBoundingClientRect();
  const nodes = Array.from(document.querySelectorAll(".meta")).filter((n) => {
    const r = n.getBoundingClientRect();
    return r.height > 0 && r.bottom > fr.top + 4 && r.top < fr.bottom - 4 && /(오전|오후)\s*\d{1,2}:\d{2}/.test(n.textContent);
  });
  if (!nodes.length) return;
  const n = nodes[Math.floor(Math.random() * nodes.length)];
  if (n.dataset.alt) return;
  const orig = n.textContent;
  const alt = orig.replace(/(오전|오후)\s*\d{1,2}:\d{2}/, HW_TEXT.horror.metaAlt);
  n.dataset.alt = "1";
  n.textContent = alt;
  setTimeout(() => {
    if (n.textContent === alt) n.textContent = orig;
    delete n.dataset.alt;
  }, 1600);
}
let hauntTick = 0;
function scheduleHaunt() {
  const delay = GLITCH_FORCE ? 3000 : 18000 + Math.random() * 22000;
  setTimeout(() => {
    if (document.documentElement.classList.contains("hw-horror") && !document.hidden && !hauntReduced()) {
      const events = [hauntEyes, hauntWhisper, hauntStatus, hauntTime];
      const pick = GLITCH_FORCE ? events[hauntTick++ % events.length] : events[Math.floor(Math.random() * events.length)];
      pick();
    }
    scheduleHaunt();
  }, delay);
}
scheduleHaunt();

/* 탭을 떠나 있는 동안 탭 제목이 바뀜 */
let titleBackup = null;
document.addEventListener("visibilitychange", () => {
  if (!document.documentElement.classList.contains("hw-horror")) {
    if (titleBackup !== null) { document.title = titleBackup; titleBackup = null; }
    return;
  }
  if (document.hidden) {
    titleBackup = document.title;
    document.title = HW_TEXT.horror.tabAway;
  } else if (titleBackup !== null) {
    document.title = titleBackup;
    titleBackup = null;
  }
});

/* 어탐기 모드: 가끔, 한 번에 하나의 말풍선 글자가 잠깐 깨졌다 돌아와요 */
const GLITCH_CHARS = "█▓▒░#@%&?¡Ж§";
function glitchOnce(node) {
  if (!node || !node.isConnected || node.dataset.orig !== undefined) return;
  const orig = node.textContent;
  if (!orig || orig.length < 2) return;
  node.dataset.orig = orig;
  node.classList.add("glitching");
  let frame = 0;
  const step = () => {
    if (!node.isConnected) return;
    if (frame >= 6) {
      node.textContent = orig;
      node.classList.remove("glitching");
      delete node.dataset.orig;
      return;
    }
    node.textContent = Array.from(orig).map((ch) =>
      (ch.trim() && Math.random() < 0.24) ? GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)] : ch
    ).join("");
    frame++;
    setTimeout(step, 130);
  };
  step();
}
function visibleGlitchNodes() {
  const feed = document.getElementById("chatFeed");
  if (!feed) return [];
  const fr = feed.getBoundingClientRect();
  return Array.from(document.querySelectorAll(".glitchable")).filter((n) => {
    const r = n.getBoundingClientRect();
    return r.height > 0 && r.bottom > fr.top + 4 && r.top < fr.bottom - 4;
  });
}
function scheduleGlitch(first) {
  const delay = GLITCH_FORCE ? 2000 : (first ? 2500 : 2500 + Math.random() * 3000);
  setTimeout(() => {
    const reduced = !GLITCH_FORCE && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (document.documentElement.classList.contains("hw-horror") && !document.hidden && !reduced && (GLITCH_FORCE || Math.random() < 0.9)) {
      const nodes = visibleGlitchNodes();
      if (nodes.length) glitchOnce(nodes[Math.floor(Math.random() * nodes.length)]);
    }
    scheduleGlitch(false);
  }, delay);
}
scheduleGlitch(true);

if (!boxId || !BOX_ID_RE.test(boxId)) {
  document.body.innerHTML = '<p style="padding:40px 20px; text-align:center; color:#78766F;">잘못된 링크예요. 익명함 주소를 다시 확인해주세요.</p>';
  throw new Error("no box id");
}

const boxRef = db.collection("boxes").doc(boxId);

/* ===== 배경음악 (유튜브) ===== */
let ytPlayer = null;
let ytReady = false;
let bgmPlaying = false;
let pendingVideoId = null;
let currentVideoId = null;

function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

window.onYouTubeIframeAPIReady = function () {
  ytReady = true;
  if (pendingVideoId) loadYtVideo(pendingVideoId);
};

function loadYtVideo(videoId) {
  if (!ytReady) {
    pendingVideoId = videoId;
    return;
  }
  if (currentVideoId === videoId && ytPlayer) return;
  currentVideoId = videoId;
  if (ytPlayer) {
    ytPlayer.loadVideoById(videoId);
    ytPlayer.pauseVideo();
  } else {
    ytPlayer = new YT.Player("bgmPlayer", {
      width: "2",
      height: "2",
      videoId,
      playerVars: { autoplay: 0, controls: 0, loop: 1, playlist: videoId },
      events: {
        onReady: () => updateBgmTitle(),
        onStateChange: (e) => {
          bgmPlaying = e.data === YT.PlayerState.PLAYING;
          updateBgmIcon();
          updateBgmTitle();
        },
      },
    });
  }
}

function updateBgmIcon() {
  el("bgmPlayIcon").hidden = bgmPlaying;
  el("bgmPauseIcon").hidden = !bgmPlaying;
}

function updateBgmTitle() {
  const titleEl = el("bgmTitle");
  if (!titleEl || !ytPlayer || typeof ytPlayer.getVideoData !== "function") return;
  const data = ytPlayer.getVideoData();
  if (data && data.title) {
    titleEl.textContent = data.title;
    titleEl.hidden = false;
  }
}

el("bgmBtn").addEventListener("click", () => {
  if (!ytPlayer) return;
  if (bgmPlaying) {
    ytPlayer.pauseVideo();
    bgmPlaying = false;
    updateBgmIcon();
  } else {
    ytPlayer.unMute();
    ytPlayer.setVolume(100);
    ytPlayer.playVideo();
    bgmPlaying = true;
    updateBgmIcon();
  }
});

window.addEventListener("pagehide", () => {
  if (ytPlayer && typeof ytPlayer.pauseVideo === "function") {
    ytPlayer.pauseVideo();
  }
});

/* ===== 박스 정보(닉네임/테마/색/상태/아바타) ===== */
boxRef.onSnapshot((doc) => {
  boxData = doc.data();
  if (!boxData) {
    el("boxNickname").textContent = "불러오는 중...";
    maybeSelfHeal();
    return;
  }
  applyTheme(boxData);

  el("boxNickname").textContent = boxData.nickname || "이름 없음";

  const status = boxData.status || { preset: "근무중", note: "" };
  let statusLine = status.note ? `${status.preset} · ${status.note}` : status.preset;
  if (status.location) statusLine += ` · ${status.location}`;
  el("statusLine").textContent = statusLine;

  if (safeImg(boxData.avatarUrl)) {
    el("mainAvatar").style.backgroundImage = cssUrl(boxData.avatarUrl);
    el("mainAvatar").textContent = "";
  } else {
    el("mainAvatar").style.backgroundImage = "none";
    el("mainAvatar").textContent = (boxData.nickname || "?").charAt(0);
  }

  const safeTwitter = safeHttpUrl(boxData.twitterUrl);
  if (safeTwitter) {
    el("mainAvatar").style.cursor = "pointer";
    el("mainAvatar").onclick = () => window.open(safeTwitter, "_blank", "noopener");
  } else {
    el("mainAvatar").style.cursor = "default";
    el("mainAvatar").onclick = null;
  }

  if (safeImg(boxData.bgUrl)) {
    el("app").style.backgroundImage = `linear-gradient(${{ cute: "rgba(21,11,34,0.84), rgba(21,11,34,0.84)", horror: "rgba(7,7,8,0.9), rgba(7,7,8,0.9)", off: "rgba(255,255,255,0.82), rgba(255,255,255,0.82)" }[halloweenMode(boxData)]}), ${cssUrl(boxData.bgUrl)}`;
    el("app").style.backgroundSize = "cover, cover";
    el("app").style.backgroundPosition = "center, center";
  } else {
    el("app").style.backgroundImage = "none";
  }

  el("attachBtn").hidden = !boxData.allowImageAttach;

  const bgmVideoId = extractYouTubeId(boxData.bgmUrl);
  el("bgmBtn").hidden = !bgmVideoId;
  if (bgmVideoId) {
    loadYtVideo(bgmVideoId);
  } else {
    const titleEl = el("bgmTitle");
    if (titleEl) titleEl.hidden = true;
  }

  renderDecoLayer();
  updateDecoAdjustVisibility();
  renderQuestions();
});

function renderDecoLayer() {
  const layer = el("decoLayer");
  layer.innerHTML = "";
  (boxData.decorations || []).forEach((d, i) => {
    const img = document.createElement("img");
    img.className = "corner-deco-item";
    const decoSrc = safeImg(d.imageUrl);
    if (!decoSrc) return;
    img.src = decoSrc;
    img.alt = "장식";
    img.dataset.id = d.id;
    const centerX = d.centerX != null ? d.centerX : 300;
    img.style.left = `calc(50vw + ${centerX}px)`;
    img.style.bottom = (d.bottom || 24) + "px";
    img.style.width = (d.width || 120) + "px";
    img.style.zIndex = String(5 + (d.z != null ? d.z : i));

    const hasInteraction = !!(d.linkUrl || d.soundUrl || d.bounce || d.sparkle || (d.quotes && d.quotes.length));
    if (hasInteraction) {
      img.style.pointerEvents = "auto";
      img.style.cursor = "pointer";
      img.addEventListener("click", () => triggerDecoInteraction(d, img));
    }

    layer.appendChild(img);
  });
}

function triggerDecoInteraction(d, img) {
  if (decoAdjustActive) return;

  if (d.bounce) {
    img.classList.remove("deco-bounce-anim");
    void img.offsetWidth;
    img.classList.add("deco-bounce-anim");
  }
  if (d.sparkle) {
    spawnSparkles(img);
  }
  if (d.quotes && d.quotes.length) {
    const quote = d.quotes[Math.floor(Math.random() * d.quotes.length)];
    showSpeechBubble(img, quote);
  }
  if (d.soundUrl) {
    const snd = safeAudio(d.soundUrl);
    if (snd) new Audio(snd).play().catch(() => {});
  }
  const link = safeHttpUrl(d.linkUrl);
  if (link) {
    window.open(link, "_blank", "noopener");
  }
}

function spawnSparkles(img) {
  const rect = img.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  for (let i = 0; i < 6; i++) {
    const s = document.createElement("div");
    s.className = "deco-sparkle";
    const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
    const dist = 30 + Math.random() * 20;
    s.style.left = cx + "px";
    s.style.top = cy + "px";
    s.style.setProperty("--dx", Math.cos(angle) * dist + "px");
    s.style.setProperty("--dy", Math.sin(angle) * dist + "px");
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 650);
  }
}

function showSpeechBubble(img, text) {
  const rect = img.getBoundingClientRect();
  const bubble = document.createElement("div");
  bubble.className = "deco-speech-bubble";
  bubble.textContent = text;
  document.body.appendChild(bubble);
  const bw = bubble.getBoundingClientRect();
  bubble.style.left = Math.max(4, rect.left + rect.width / 2 - bw.width / 2) + "px";
  bubble.style.top = Math.max(4, rect.top - bw.height - 10) + "px";
  requestAnimationFrame(() => bubble.classList.add("show"));
  setTimeout(() => {
    bubble.classList.remove("show");
    setTimeout(() => bubble.remove(), 250);
  }, 2200);
}

function updateDecoAdjustVisibility() {
  el("decoAdjustMenuItem").hidden = !(isAdmin && boxData && boxData.decorations && boxData.decorations.length > 0);
}

function applyTheme(box) {
  const root = document.documentElement.style;
  root.setProperty("--accent", box.color || "#185FA5");
  if (box.theme === "disaster") {
    root.setProperty("--page", "#E4EBF1");
    root.setProperty("--surface", "#FBFDFE");
    root.setProperty("--surface-2", "#DCE6EE");
    root.setProperty("--line", "#C3D2DC");
  } else if (box.theme === "basic") {
    root.setProperty("--page", "#F2F2F0");
    root.setProperty("--surface", "#FFFFFF");
    root.setProperty("--surface-2", "#F7F7F5");
    root.setProperty("--line", "#E5E5E3");
  } else {
    root.removeProperty("--page");
    root.removeProperty("--surface");
    root.removeProperty("--surface-2");
    root.removeProperty("--line");
  }
  const hwMode = halloweenMode(box);
  if (hwMode === "cute") {
    root.setProperty("--accent", "#E8680A");
    root.setProperty("--accent-hover", "#C85606");
    root.setProperty("--page", "#150B22");
    root.setProperty("--surface", "#21132F");
    root.setProperty("--surface-2", "#2E1B43");
    root.setProperty("--line", "#4A3166");
    root.setProperty("--ink", "#F5ECFF");
    root.setProperty("--muted", "#B9A5D3");
    root.setProperty("--success", "#FFB23E");
  } else if (hwMode === "horror") {
    root.setProperty("--accent", "#8B1A1A");
    root.setProperty("--accent-hover", "#6E1414");
    root.setProperty("--page", "#070708");
    root.setProperty("--surface", "#101012");
    root.setProperty("--surface-2", "#19191C");
    root.setProperty("--line", "#2E2E33");
    root.setProperty("--ink", "#DADADD");
    root.setProperty("--muted", "#85858C");
    root.setProperty("--success", "#B04040");
  } else {
    root.removeProperty("--accent-hover");
    root.removeProperty("--ink");
    root.removeProperty("--muted");
    root.removeProperty("--success");
  }
  renderHalloweenLayer(hwMode);
  el("hwCandyBtn").hidden = hwMode === "off";
  el("questionInput").placeholder = hwMode === "off" ? DEFAULT_PLACEHOLDER : HW_TEXT[hwMode].placeholder;

  if (box.theme === "disaster") {
    el("workspaceLogo").src = "disaster_logo.png";
    el("workspaceName").textContent = "초자연 재난관리국";
    el("workspaceSub").textContent = "긴급 대응 채널";
  } else if (box.theme === "basic") {
    el("workspaceLogo").src = "basic_logo.png";
    el("workspaceName").textContent = "출근해도 익명으로 대화해야 하는구나";
    el("workspaceSub").textContent = "익명 질문함";
  } else {
    el("workspaceLogo").src = "daydream_logo.png";
    el("workspaceName").textContent = "Daydream Inc.";
    el("workspaceSub").textContent = "백일몽 주식회사";
  }
}

/* ===== 로그인 상태 (이 박스의 주인인지 확인) ===== */
let healed = false;
async function maybeSelfHeal() {
  if (healed) return;
  const user = auth.currentUser;
  if (!user || user.uid !== boxId) return;
  if (boxData) return;
  healed = true;
  await boxRef.set({
    nickname: "이름 없음",
    theme: "daydream",
    color: "#185FA5",
    status: { preset: "근무중", note: "" },
    showTime: true,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

auth.onAuthStateChanged((user) => {
  isAdmin = !!user && user.uid === boxId;
  el("loginMenuItem").hidden = isAdmin;
  el("profileMenuItem").hidden = !isAdmin;
  el("logoutMenuItem").hidden = !isAdmin;
  updateDecoAdjustVisibility();
  renderQuestions();
});

/* ===== 질문 피드 ===== */
boxRef.collection("questions").orderBy("createdAt", "asc").onSnapshot((snap) => {
  cachedQuestions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderQuestions();
});

function formatTime(ts) {
  if (!ts) return "방금";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderQuestions() {
  const feed = el("chatFeed");
  feed.innerHTML = "";

  if (!boxData) return;

  if (cachedQuestions.length === 0) {
    const hwm = halloweenMode(boxData);
    const emptyP = document.createElement("p");
    emptyP.className = "empty-state";
    emptyP.textContent = hwm === "off" ? DEFAULT_EMPTY : HW_TEXT[hwm].empty;
    feed.appendChild(emptyP);
    return;
  }

  const showTime = boxData.showTime !== false;

  cachedQuestions.forEach((q) => {
    const block = document.createElement("div");
    block.className = "qa-block";

    const qBubble = document.createElement("div");
    qBubble.className = "bubble question";
    if (safeImg(q.imageUrl)) {
      const img = document.createElement("img");
      img.className = "bubble-image";
      img.src = safeImg(q.imageUrl);
      img.alt = "첨부한 사진";
      qBubble.appendChild(img);
    }
    const qText = document.createElement("span");
    qText.className = "glitchable";
    qText.textContent = q.text;
    qBubble.appendChild(qText);
    block.appendChild(qBubble);

    if (showTime) {
      const qMeta = document.createElement("p");
      qMeta.className = "meta right";
      qMeta.textContent = `익명 · ${formatTime(q.createdAt)}`;
      block.appendChild(qMeta);
    }

    if (q.answer) {
      const row = document.createElement("div");
      row.className = "answer-row";

      let img;
      if (safeImg(q.expressionImageUrl)) {
        img = document.createElement("img");
        img.className = "char-avatar-img";
        img.src = safeImg(q.expressionImageUrl);
        img.alt = boxData.nickname || "";
      } else {
        img = document.createElement("div");
        img.className = "char-avatar";
        if (safeImg(boxData.avatarUrl)) {
          img.style.backgroundImage = cssUrl(boxData.avatarUrl);
        } else {
          img.textContent = (boxData.nickname || "?").charAt(0);
        }
      }
      row.appendChild(img);

      const aBubble = document.createElement("div");
      aBubble.className = "bubble answer glitchable";
      aBubble.textContent = q.answer;
      row.appendChild(aBubble);

      block.appendChild(row);

      if (showTime) {
        const aMeta = document.createElement("p");
        aMeta.className = "meta left";
        aMeta.textContent = formatTime(q.answeredAt);
        block.appendChild(aMeta);
      }

      if (isAdmin) {
        const actions = document.createElement("div");
        actions.className = "admin-actions";

        const editBtn = document.createElement("button");
        editBtn.className = "answer-cta";
        editBtn.textContent = "수정";
        editBtn.addEventListener("click", () => openAnswerModal(q.id, q.text, q.answer, q.expressionImageUrl));
        actions.appendChild(editBtn);

        const undoBtn = document.createElement("button");
        undoBtn.className = "answer-cta";
        undoBtn.textContent = "답변 취소";
        undoBtn.addEventListener("click", () => retractAnswer(q.id));
        actions.appendChild(undoBtn);
        actions.appendChild(createDeleteButton(q.id));

        block.appendChild(actions);
      }
    } else if (isAdmin) {
      const actions = document.createElement("div");
      actions.className = "admin-actions";

      const btn = document.createElement("button");
      btn.className = "answer-cta";
      btn.textContent = "답변하기";
      btn.addEventListener("click", () => openAnswerModal(q.id, q.text));
      actions.appendChild(btn);
      actions.appendChild(createDeleteButton(q.id));

      block.appendChild(actions);
    }

    feed.appendChild(block);
  });

  feed.scrollTop = feed.scrollHeight;
}

function createDeleteButton(id) {
  const btn = document.createElement("button");
  btn.className = "icon-btn";
  btn.setAttribute("aria-label", "삭제");
  btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
  btn.addEventListener("click", () => {
    if (confirm("이 질문을 삭제할까요? 답변도 함께 사라져요.")) {
      boxRef.collection("questions").doc(id).delete();
    }
  });
  return btn;
}

async function retractAnswer(id) {
  if (!confirm("답변을 취소하고 미답변 상태로 되돌릴까요?")) return;
  await boxRef.collection("questions").doc(id).update({
    answer: null,
    answeredAt: null,
    expressionImageUrl: null,
  });
}

/* ===== 질문 제출 (사진 첨부 포함) ===== */
let composerImageFile = null;

el("attachBtn").addEventListener("click", () => el("composerImageInput").click());

el("composerImageInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  composerImageFile = file;
  el("composerImageThumb").src = URL.createObjectURL(file);
  el("composerImagePreview").hidden = false;
});

el("composerImageRemove").addEventListener("click", () => {
  composerImageFile = null;
  el("composerImageInput").value = "";
  el("composerImagePreview").hidden = true;
});

el("composerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = el("questionInput");
  const text = input.value.trim();
  if (!text) return;

  const payload = {
    text,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    answer: null,
    answeredAt: null,
  };

  try {
    if (composerImageFile) {
      payload.imageUrl = await resizeImageToDataUrl(composerImageFile, 640, 0.7);
    }

    await boxRef.collection("questions").add(payload);

    input.value = "";
    composerImageFile = null;
    el("composerImageInput").value = "";
    el("composerImagePreview").hidden = true;
  } catch (err) {
    alert("전송에 실패했어요: " + err.message);
  }
});

/* ===== 슬라이드 메뉴 ===== */
el("menuBtn").addEventListener("click", () => el("menuBackdrop").classList.add("open"));
el("menuBackdrop").addEventListener("click", (e) => {
  if (e.target === el("menuBackdrop")) el("menuBackdrop").classList.remove("open");
});

el("copyLinkMenuItem").addEventListener("click", async () => {
  el("menuBackdrop").classList.remove("open");
  const url = `${location.origin}${location.pathname}?id=${boxId}`;
  try {
    await navigator.clipboard.writeText(url);
    alert("링크를 복사했어요.");
  } catch (err) {
    prompt("아래 링크를 복사하세요", url);
  }
});

el("loginMenuItem").addEventListener("click", () => {
  el("menuBackdrop").classList.remove("open");
  el("loginError").hidden = true;
  el("passwordInput").value = "";
  el("loginBackdrop").classList.add("open");
});

el("logoutMenuItem").addEventListener("click", async () => {
  el("menuBackdrop").classList.remove("open");
  await auth.signOut();
});

/* ===== 로그인 모달 ===== */
el("loginCancel").addEventListener("click", () => el("loginBackdrop").classList.remove("open"));
el("loginBackdrop").addEventListener("click", (e) => {
  if (e.target === el("loginBackdrop")) el("loginBackdrop").classList.remove("open");
});
el("loginSubmit").addEventListener("click", async () => {
  const password = el("passwordInput").value;
  if (!password) return;
  const id = prompt("아이디를 입력하세요");
  if (!id) return;
  try {
    const cred = await auth.signInWithEmailAndPassword(`${id}@${EMAIL_DOMAIN}`, password);
    if (cred.user.uid !== boxId) {
      await auth.signOut();
      el("loginError").textContent = "이 익명함의 주인이 아니에요.";
      el("loginError").hidden = false;
      return;
    }
    el("loginBackdrop").classList.remove("open");
  } catch (err) {
    el("loginError").textContent = "아이디 또는 비밀번호가 올바르지 않아요.";
    el("loginError").hidden = false;
  }
});

el("decoAdjustMenuItem").addEventListener("click", () => {
  el("menuBackdrop").classList.remove("open");
  enterDecoAdjustMode();
});

el("decoAdjustDone").addEventListener("click", () => exitDecoAdjustMode(true));

let decoAdjustActive = false;
let adjustZState = [];

function enterDecoAdjustMode() {
  decoAdjustActive = true;
  adjustZState = (boxData.decorations || []).map((d, i) => ({ id: d.id, z: d.z != null ? d.z : i }));

  document.querySelectorAll(".corner-deco-item").forEach((img) => {
    img.style.pointerEvents = "auto";
    img.style.cursor = "move";
    img.style.outline = "2px dashed var(--accent)";

    const handle = document.createElement("div");
    handle.className = "deco-resize-handle visible";
    handle.dataset.for = img.dataset.id;
    document.body.appendChild(handle);
    positionResizeHandleFor(img, handle);

    const toolbar = document.createElement("div");
    toolbar.className = "deco-order-toolbar";
    toolbar.dataset.for = img.dataset.id;
    toolbar.innerHTML =
      '<button type="button" data-action="back">뒤로</button>' +
      '<button type="button" data-action="front">앞으로</button>';
    document.body.appendChild(toolbar);
    positionOrderToolbarFor(img, toolbar);
  });
  el("decoAdjustDone").classList.add("visible");
}

function exitDecoAdjustMode(save) {
  decoAdjustActive = false;
  document.querySelectorAll(".deco-resize-handle, .deco-order-toolbar").forEach((n) => n.remove());
  el("decoAdjustDone").classList.remove("visible");

  document.querySelectorAll(".corner-deco-item").forEach((img) => {
    img.style.outline = "";
    const d = (boxData.decorations || []).find((x) => x.id === img.dataset.id);
    const hasInteraction = !!(d && (d.linkUrl || d.soundUrl || d.bounce || d.sparkle || (d.quotes && d.quotes.length)));
    img.style.pointerEvents = hasInteraction ? "auto" : "none";
    img.style.cursor = hasInteraction ? "pointer" : "";
  });

  if (save) {
    const updated = (boxData.decorations || []).map((d) => {
      const img = document.querySelector(`.corner-deco-item[data-id="${d.id}"]`);
      const zEntry = adjustZState.find((z) => z.id === d.id);
      const merged = { ...d };
      if (img) {
        const rect = img.getBoundingClientRect();
        merged.centerX = Math.round(rect.left - window.innerWidth / 2);
        merged.bottom = Math.round(window.innerHeight - rect.bottom);
        merged.width = Math.round(rect.width);
        delete merged.right;
      }
      if (zEntry) merged.z = zEntry.z;
      return merged;
    });
    boxRef.update({ decorations: updated });
  }
  adjustZState = [];
}

function positionResizeHandleFor(img, handle) {
  const rect = img.getBoundingClientRect();
  handle.style.left = (rect.right - 7) + "px";
  handle.style.top = (rect.bottom - 7) + "px";
}

function positionOrderToolbarFor(img, toolbar) {
  const rect = img.getBoundingClientRect();
  toolbar.style.left = rect.left + "px";
  toolbar.style.top = (rect.top - 32) + "px";
}

document.addEventListener("click", (e) => {
  if (!decoAdjustActive) return;
  const btn = e.target.closest(".deco-order-toolbar button");
  if (!btn) return;
  const id = btn.closest(".deco-order-toolbar").dataset.for;
  const entry = adjustZState.find((z) => z.id === id);
  if (!entry) return;
  const zs = adjustZState.map((z) => z.z);
  entry.z = btn.dataset.action === "front" ? Math.max(...zs) + 1 : Math.min(...zs) - 1;
  const img = document.querySelector(`.corner-deco-item[data-id="${id}"]`);
  if (img) img.style.zIndex = String(5 + entry.z);
});

el("decoLayer").addEventListener("mousedown", (e) => {
  if (!decoAdjustActive) return;
  const img = e.target.closest(".corner-deco-item");
  if (!img) return;
  e.preventDefault();
  const rect = img.getBoundingClientRect();
  const startCenterX = rect.left - window.innerWidth / 2;
  const startBottom = window.innerHeight - rect.bottom;
  const startX = e.clientX;
  const startY = e.clientY;
  const handle = document.querySelector(`.deco-resize-handle[data-for="${img.dataset.id}"]`);
  const toolbar = document.querySelector(`.deco-order-toolbar[data-for="${img.dataset.id}"]`);

  function onMove(ev) {
    const newCenterX = startCenterX + (ev.clientX - startX);
    img.style.left = `calc(50vw + ${newCenterX}px)`;
    img.style.bottom = (startBottom - (ev.clientY - startY)) + "px";
    if (handle) positionResizeHandleFor(img, handle);
    if (toolbar) positionOrderToolbarFor(img, toolbar);
  }
  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

document.addEventListener("mousedown", (e) => {
  if (!decoAdjustActive) return;
  const handle = e.target.closest(".deco-resize-handle");
  if (!handle) return;
  e.preventDefault();
  e.stopPropagation();
  const img = document.querySelector(`.corner-deco-item[data-id="${handle.dataset.for}"]`);
  if (!img) return;
  const startWidth = img.getBoundingClientRect().width;
  const startX = e.clientX;
  const toolbar = document.querySelector(`.deco-order-toolbar[data-for="${handle.dataset.for}"]`);

  function onMove(ev) {
    const newWidth = Math.min(400, Math.max(50, startWidth + (ev.clientX - startX)));
    img.style.width = newWidth + "px";
    positionResizeHandleFor(img, handle);
    if (toolbar) positionOrderToolbarFor(img, toolbar);
  }
  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

/* ===== 프로필 설정 모달 ===== */
let selectedAvatarFile = null;
let selectedBgFile = null;
let clearBg = false;
let workingExpressions = [];

function renderExprList() {
  const list = el("exprList");
  list.innerHTML = "";
  workingExpressions.forEach((expr) => {
    const chip = document.createElement("span");
    chip.className = "expr-chip";
    const img = document.createElement("img");
    img.src = safeImg(expr.imageUrl);
    img.alt = expr.label;
    chip.appendChild(img);
    const label = document.createElement("span");
    label.textContent = expr.label;
    chip.appendChild(label);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", "표정 삭제");
    removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>';
    removeBtn.addEventListener("click", () => {
      workingExpressions = workingExpressions.filter((e) => e.id !== expr.id);
      renderExprList();
    });
    chip.appendChild(removeBtn);
    list.appendChild(chip);
  });
}

el("exprAddBtn").addEventListener("click", async () => {
  const label = el("exprLabelInput").value.trim();
  const file = el("exprFileInput").files[0];
  if (!label || !file) {
    alert("표정 이름과 사진을 둘 다 넣어주세요.");
    return;
  }
  try {
    const imageUrl = await resizeImageToDataUrl(file, 200, 0.85, "png");
    workingExpressions.push({ id: `${Date.now()}`, label, imageUrl });
    el("exprLabelInput").value = "";
    el("exprFileInput").value = "";
    renderExprList();
  } catch (err) {
    alert(err.message || "사진 처리에 실패했어요.");
  }
});

let workingDecorations = [];

function renderDecoList() {
  const list = el("decoList");
  list.innerHTML = "";
  workingDecorations.forEach((d) => {
    const item = document.createElement("div");
    item.className = "deco-item";

    const row = document.createElement("div");
    row.className = "deco-item-row";

    const img = document.createElement("img");
    img.src = safeImg(d.imageUrl);
    img.alt = "장식";
    row.appendChild(img);

    const label = document.createElement("span");
    label.className = "deco-item-label";
    const tags = [];
    if (d.linkUrl) tags.push("링크");
    if (d.soundUrl) tags.push("소리");
    if (d.bounce) tags.push("통통");
    if (d.sparkle) tags.push("반짝");
    if (d.quotes && d.quotes.length) tags.push("말풍선");
    label.textContent = tags.length ? tags.join(" · ") : "반응 없음";
    row.appendChild(label);

    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.setAttribute("aria-label", "장식 설정");
    settingsBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    row.appendChild(settingsBtn);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", "장식 삭제");
    removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>';
    removeBtn.addEventListener("click", () => {
      workingDecorations = workingDecorations.filter((x) => x.id !== d.id);
      renderDecoList();
    });
    row.appendChild(removeBtn);

    item.appendChild(row);

    const panel = document.createElement("div");
    panel.className = "deco-settings";
    panel.hidden = true;

    panel.innerHTML = `
      <input type="text" placeholder="링크 주소 (선택)" data-field="linkUrl">
      <input type="file" accept="audio/*" data-field="soundFile">
      <div class="deco-check-row">
        <label><input type="checkbox" data-field="bounce"> 통통 튀는 애니메이션</label>
        <label><input type="checkbox" data-field="sparkle"> 반짝이 효과</label>
      </div>
      <textarea placeholder="말풍선 문구 (한 줄에 하나씩, 클릭할 때마다 랜덤으로 하나 표시)" data-field="quotes"></textarea>
      <p class="deco-settings-note" data-field="soundNote"></p>
    `;

    const linkInput = panel.querySelector('[data-field="linkUrl"]');
    linkInput.value = d.linkUrl || "";
    linkInput.addEventListener("input", () => { d.linkUrl = linkInput.value.trim(); });
    /* 저장 직전에 normalizeHttpUrl로 한 번 더 정리됨 */

    const bounceInput = panel.querySelector('[data-field="bounce"]');
    bounceInput.checked = !!d.bounce;
    bounceInput.addEventListener("change", () => { d.bounce = bounceInput.checked; label.textContent = decoTagsLabel(d); });

    const sparkleInput = panel.querySelector('[data-field="sparkle"]');
    sparkleInput.checked = !!d.sparkle;
    sparkleInput.addEventListener("change", () => { d.sparkle = sparkleInput.checked; label.textContent = decoTagsLabel(d); });

    const quotesInput = panel.querySelector('[data-field="quotes"]');
    quotesInput.value = (d.quotes || []).join("\n");
    quotesInput.addEventListener("input", () => {
      d.quotes = quotesInput.value.split("\n").map((s) => s.trim()).filter(Boolean);
    });

    const soundNote = panel.querySelector('[data-field="soundNote"]');
    soundNote.textContent = d.soundUrl ? "소리 파일 등록됨" : "";

    const soundInput = panel.querySelector('[data-field="soundFile"]');
    soundInput.addEventListener("change", async () => {
      const file = soundInput.files[0];
      if (!file) return;
      try {
        d.soundUrl = await fileToDataUrlCapped(file, 300 * 1024, "소리 파일이 너무 커요. 300KB 이하로 줄여서 다시 시도해주세요.");
        soundNote.textContent = "소리 파일 등록됨";
        label.textContent = decoTagsLabel(d);
      } catch (err) {
        alert(err.message || "소리 파일 처리에 실패했어요.");
      }
    });

    settingsBtn.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      renderDecoList.__preserveOpen = panel.hidden ? null : d.id;
    });
    if (renderDecoList.__preserveOpen === d.id) panel.hidden = false;

    item.appendChild(panel);
    list.appendChild(item);
  });
}

function decoTagsLabel(d) {
  const tags = [];
  if (d.linkUrl) tags.push("링크");
  if (d.soundUrl) tags.push("소리");
  if (d.bounce) tags.push("통통");
  if (d.sparkle) tags.push("반짝");
  if (d.quotes && d.quotes.length) tags.push("말풍선");
  return tags.length ? tags.join(" · ") : "반응 없음";
}

el("decoAddBtn").addEventListener("click", async () => {
  const file = el("decoFileInput").files[0];
  if (!file) {
    alert("사진을 선택해주세요.");
    return;
  }
  try {
    const imageUrl = await resizeImageToDataUrl(file, 400, 0.85, "png");
    const idx = workingDecorations.length;
    workingDecorations.push({
      id: `${Date.now()}`,
      imageUrl,
      centerX: 300 + idx * 24,
      bottom: 24 + idx * 24,
      width: 120,
      linkUrl: "",
      soundUrl: "",
      bounce: false,
      sparkle: false,
      quotes: [],
    });
    el("decoFileInput").value = "";
    renderDecoList();
  } catch (err) {
    alert(err.message || "사진 처리에 실패했어요.");
  }
});

function fileToDataUrlCapped(file, maxBytes, tooBigMessage) {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error(tooBigMessage));
      return;
    }
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

function resizeImageToDataUrl(file, maxSize = 240, quality = 0.85, format = "jpeg") {
  if (file.type === "image/gif") {
    return new Promise((resolve, reject) => {
      if (file.size > 700 * 1024) {
        reject(new Error("움짤 용량이 너무 커요. 700KB 이하로 줄여서 다시 시도해주세요."));
        return;
      }
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        if (format === "png") {
          resolve(canvas.toDataURL("image/png"));
        } else {
          resolve(canvas.toDataURL("image/jpeg", quality));
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

el("profileMenuItem").addEventListener("click", () => {
  el("menuBackdrop").classList.remove("open");
  if (!boxData) return;

  selectedAvatarFile = null;
  selectedBgFile = null;
  clearBg = false;
  el("avatarFileInput").value = "";
  el("bgFileInput").value = "";
  el("profileError").hidden = true;

  el("avatarPreview").style.backgroundImage = el("mainAvatar").style.backgroundImage;
  el("bgPreview").style.backgroundImage = cssUrl(boxData.bgUrl);
  el("nicknameInput").value = boxData.nickname || "";
  el("twitterInput").value = boxData.twitterUrl || "";
  el("bgmInput").value = boxData.bgmUrl || "";

  workingExpressions = (boxData.expressions || []).slice();
  el("exprLabelInput").value = "";
  el("exprFileInput").value = "";
  renderExprList();

  workingDecorations = (boxData.decorations || []).map((d) => ({ ...d, quotes: (d.quotes || []).slice() }));
  el("decoFileInput").value = "";
  renderDecoList.__preserveOpen = null;
  renderDecoList();

  const status = boxData.status || { preset: "근무중", note: "", location: "" };
  renderPresetRow(boxData.theme, status.preset);
  el("statusNoteInput").value = status.note || "";
  el("locationInput").value = status.location || "";

  document.querySelectorAll(".color-swatch").forEach((b) => {
    b.classList.toggle("active", b.dataset.color === (boxData.color || "#185FA5"));
  });

  const showTime = boxData.showTime !== false;
  el("showTimeToggle").setAttribute("aria-pressed", showTime ? "true" : "false");
  el("allowImageToggle").setAttribute("aria-pressed", boxData.allowImageAttach ? "true" : "false");
  el("halloweenRow").hidden = !isHalloweenWindow();
  const curMode = boxData.halloweenMode || (boxData.halloweenOn === true ? "cute" : "off");
  el("halloweenModeBtns").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === curMode));

  el("profileBackdrop").classList.add("open");
});

el("profileCancel").addEventListener("click", () => el("profileBackdrop").classList.remove("open"));
el("profileBackdrop").addEventListener("click", (e) => {
  if (e.target === el("profileBackdrop")) el("profileBackdrop").classList.remove("open");
});

const PRESET_SETS = {
  basic: ["온라인", "자리비움", "오프라인"],
  default: ["근무중", "회의중", "자리비움"],
};

function renderPresetRow(theme, activePreset) {
  const presets = theme === "basic" ? PRESET_SETS.basic : PRESET_SETS.default;
  el("presetRow").innerHTML = presets
    .map((p) => `<button type="button" class="preset-btn${p === activePreset ? " active" : ""}" data-preset="${p}">${p}</button>`)
    .join("");
}

el("presetRow").addEventListener("click", (e) => {
  const b = e.target.closest(".preset-btn");
  if (!b) return;
  el("presetRow").querySelectorAll(".preset-btn").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
});

document.querySelectorAll(".color-swatch").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".color-swatch").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
  });
});

el("showTimeToggle").addEventListener("click", () => {
  const pressed = el("showTimeToggle").getAttribute("aria-pressed") === "true";
  el("showTimeToggle").setAttribute("aria-pressed", pressed ? "false" : "true");
});

el("halloweenModeBtns").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  el("halloweenModeBtns").querySelectorAll("button").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
});

el("allowImageToggle").addEventListener("click", () => {
  const pressed = el("allowImageToggle").getAttribute("aria-pressed") === "true";
  el("allowImageToggle").setAttribute("aria-pressed", pressed ? "false" : "true");
});

el("avatarFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  selectedAvatarFile = file;
  el("avatarPreview").style.backgroundImage = `url(${URL.createObjectURL(file)})`;
});

el("bgFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  selectedBgFile = file;
  clearBg = false;
  el("bgPreview").style.backgroundImage = `url(${URL.createObjectURL(file)})`;
});

el("bgClearBtn").addEventListener("click", () => {
  selectedBgFile = null;
  clearBg = true;
  el("bgFileInput").value = "";
  el("bgPreview").style.backgroundImage = "none";
});

el("profileSubmit").addEventListener("click", async () => {
  el("profileError").hidden = true;
  el("profileSubmit").disabled = true;
  el("profileSubmit").textContent = "저장 중...";

  try {
    const nickname = el("nicknameInput").value.trim() || "이름 없음";
    const twitterUrl = normalizeHttpUrl(el("twitterInput").value);
    const bgmUrl = el("bgmInput").value.trim();
    const activePreset = document.querySelector(".preset-btn.active");
    const activeColor = document.querySelector(".color-swatch.active");
    const showTime = el("showTimeToggle").getAttribute("aria-pressed") === "true";
    const allowImageAttach = el("allowImageToggle").getAttribute("aria-pressed") === "true";

    const update = {
      nickname,
      twitterUrl,
      bgmUrl,
      color: activeColor ? activeColor.dataset.color : (boxData.color || "#185FA5"),
      status: {
        preset: activePreset ? activePreset.dataset.preset : "근무중",
        note: el("statusNoteInput").value.trim(),
        location: el("locationInput").value.trim(),
      },
      showTime,
      allowImageAttach,
      expressions: workingExpressions,
      decorations: workingDecorations.map((d) => ({ ...d, linkUrl: normalizeHttpUrl(d.linkUrl) })),
    };

    if (!el("halloweenRow").hidden) {
      const activeMode = el("halloweenModeBtns").querySelector("button.active");
      update.halloweenMode = activeMode ? activeMode.dataset.mode : "off";
      if (boxData.halloweenOn !== undefined) update.halloweenOn = firebase.firestore.FieldValue.delete();
    }

    if (selectedAvatarFile) {
      update.avatarUrl = await resizeImageToDataUrl(selectedAvatarFile, 240, 0.85, "png");
    }
    if (selectedBgFile) {
      update.bgUrl = await resizeImageToDataUrl(selectedBgFile, 480, 0.7);
    } else if (clearBg) {
      update.bgUrl = firebase.firestore.FieldValue.delete();
    }

    await boxRef.update(update);
    el("profileBackdrop").classList.remove("open");
  } catch (err) {
    el("profileError").textContent = "저장에 실패했어요. 다시 시도해주세요.";
    el("profileError").hidden = false;
  } finally {
    el("profileSubmit").disabled = false;
    el("profileSubmit").textContent = "저장";
  }
});

/* ===== 답변 작성 모달 ===== */
let answeringId = null;
let selectedExpressionImageUrl = null;
let editingExistingAnswer = false;

function openAnswerModal(id, questionText, existingAnswer, existingExpressionImageUrl) {
  answeringId = id;
  el("answerQuestionText").textContent = questionText;
  el("answerInput").value = existingAnswer || "";
  editingExistingAnswer = !!existingAnswer;
  el("answerModalTitle").textContent = editingExistingAnswer ? "답변 수정" : "답변 작성";
  selectedExpressionImageUrl = existingExpressionImageUrl || null;
  updateExpressionButton();
  renderExpressionPicker();
  el("expressionPicker").hidden = true;
  el("answerBackdrop").classList.add("open");
}

function updateExpressionButton() {
  const url = selectedExpressionImageUrl || (boxData && boxData.avatarUrl);
  el("expressionBtn").style.backgroundImage = cssUrl(url);
  const match = (boxData && boxData.expressions || []).find((e) => e.imageUrl === selectedExpressionImageUrl);
  el("expressionLabel").textContent = match ? match.label : "기본";
}

function renderExpressionPicker() {
  const picker = el("expressionPicker");
  picker.innerHTML = "";

  const defaultBtn = document.createElement("button");
  defaultBtn.type = "button";
  defaultBtn.textContent = "기본";
  defaultBtn.classList.toggle("active", !selectedExpressionImageUrl);
  defaultBtn.addEventListener("click", () => {
    selectedExpressionImageUrl = null;
    updateExpressionButton();
    renderExpressionPicker();
    picker.hidden = true;
  });
  picker.appendChild(defaultBtn);

  (( boxData && boxData.expressions) || []).forEach((expr) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.toggle("active", selectedExpressionImageUrl === expr.imageUrl);
    const img = document.createElement("img");
    img.src = safeImg(expr.imageUrl);
    img.alt = expr.label;
    btn.appendChild(img);
    const span = document.createElement("span");
    span.textContent = expr.label;
    btn.appendChild(span);
    btn.addEventListener("click", () => {
      selectedExpressionImageUrl = expr.imageUrl;
      updateExpressionButton();
      renderExpressionPicker();
      picker.hidden = true;
    });
    picker.appendChild(btn);
  });
}

el("expressionBtn").addEventListener("click", () => {
  el("expressionPicker").hidden = !el("expressionPicker").hidden;
});

el("answerCancel").addEventListener("click", () => el("answerBackdrop").classList.remove("open"));
el("answerBackdrop").addEventListener("click", (e) => {
  if (e.target === el("answerBackdrop")) el("answerBackdrop").classList.remove("open");
});

el("answerSubmit").addEventListener("click", async () => {
  const answer = el("answerInput").value.trim();
  if (!answer || !answeringId) return;
  const update = {
    answer,
    expressionImageUrl: selectedExpressionImageUrl,
  };
  if (!editingExistingAnswer) {
    update.answeredAt = firebase.firestore.FieldValue.serverTimestamp();
  }
  await boxRef.collection("questions").doc(answeringId).update(update);
  el("answerBackdrop").classList.remove("open");
});
