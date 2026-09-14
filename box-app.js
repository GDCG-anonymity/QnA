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

if (!boxId) {
  document.body.innerHTML = '<p style="padding:40px 20px; text-align:center; color:#78766F;">잘못된 링크예요. 익명함 주소를 다시 확인해주세요.</p>';
  throw new Error("no box id");
}

const boxRef = db.collection("boxes").doc(boxId);

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

  if (boxData.avatarUrl) {
    el("mainAvatar").style.backgroundImage = `url(${boxData.avatarUrl})`;
    el("mainAvatar").textContent = "";
  } else {
    el("mainAvatar").style.backgroundImage = "none";
    el("mainAvatar").textContent = (boxData.nickname || "?").charAt(0);
  }

  if (boxData.twitterUrl) {
    el("mainAvatar").style.cursor = "pointer";
    el("mainAvatar").onclick = () => window.open(boxData.twitterUrl, "_blank", "noopener");
  } else {
    el("mainAvatar").style.cursor = "default";
    el("mainAvatar").onclick = null;
  }

  if (boxData.bgUrl) {
    el("app").style.backgroundImage = `linear-gradient(rgba(255,255,255,0.82), rgba(255,255,255,0.82)), url(${boxData.bgUrl})`;
    el("app").style.backgroundSize = "cover, cover";
    el("app").style.backgroundPosition = "center, center";
  } else {
    el("app").style.backgroundImage = "none";
  }

  el("attachBtn").hidden = !boxData.allowImageAttach;

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
    img.src = d.imageUrl;
    img.alt = "장식";
    img.dataset.id = d.id;
    const centerX = d.centerX != null ? d.centerX : 300;
    img.style.left = `calc(50vw + ${centerX}px)`;
    img.style.bottom = (d.bottom || 24) + "px";
    img.style.width = (d.width || 120) + "px";
    img.style.zIndex = String(5 + (d.z != null ? d.z : i));
    layer.appendChild(img);
  });
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
    feed.innerHTML = '<p class="empty-state">아직 아무도 흥미로운 걸 안 물어봤군요.</p>';
    return;
  }

  const showTime = boxData.showTime !== false;

  cachedQuestions.forEach((q) => {
    const block = document.createElement("div");
    block.className = "qa-block";

    const qBubble = document.createElement("div");
    qBubble.className = "bubble question";
    if (q.imageUrl) {
      const img = document.createElement("img");
      img.className = "bubble-image";
      img.src = q.imageUrl;
      img.alt = "첨부한 사진";
      qBubble.appendChild(img);
    }
    const qText = document.createElement("span");
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
      if (q.expressionImageUrl) {
        img = document.createElement("img");
        img.className = "char-avatar-img";
        img.src = q.expressionImageUrl;
        img.alt = boxData.nickname || "";
      } else {
        img = document.createElement("div");
        img.className = "char-avatar";
        if (boxData.avatarUrl) {
          img.style.backgroundImage = `url(${boxData.avatarUrl})`;
        } else {
          img.textContent = (boxData.nickname || "?").charAt(0);
        }
      }
      row.appendChild(img);

      const aBubble = document.createElement("div");
      aBubble.className = "bubble answer";
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
  document.querySelectorAll(".corner-deco-item").forEach((img) => {
    img.style.pointerEvents = "none";
    img.style.cursor = "";
    img.style.outline = "";
  });
  document.querySelectorAll(".deco-resize-handle, .deco-order-toolbar").forEach((n) => n.remove());
  el("decoAdjustDone").classList.remove("visible");

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
    img.src = expr.imageUrl;
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
    const chip = document.createElement("span");
    chip.className = "expr-chip";
    const img = document.createElement("img");
    img.src = d.imageUrl;
    img.alt = "장식";
    chip.appendChild(img);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", "장식 삭제");
    removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>';
    removeBtn.addEventListener("click", () => {
      workingDecorations = workingDecorations.filter((x) => x.id !== d.id);
      renderDecoList();
    });
    chip.appendChild(removeBtn);
    list.appendChild(chip);
  });
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
    });
    el("decoFileInput").value = "";
    renderDecoList();
  } catch (err) {
    alert(err.message || "사진 처리에 실패했어요.");
  }
});

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
  el("bgPreview").style.backgroundImage = boxData.bgUrl ? `url(${boxData.bgUrl})` : "none";
  el("nicknameInput").value = boxData.nickname || "";
  el("twitterInput").value = boxData.twitterUrl || "";

  workingExpressions = (boxData.expressions || []).slice();
  el("exprLabelInput").value = "";
  el("exprFileInput").value = "";
  renderExprList();

  workingDecorations = (boxData.decorations || []).slice();
  el("decoFileInput").value = "";
  renderDecoList();

  const status = boxData.status || { preset: "근무중", note: "", location: "" };
  document.querySelectorAll(".preset-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.preset === status.preset);
  });
  el("statusNoteInput").value = status.note || "";
  el("locationInput").value = status.location || "";

  document.querySelectorAll(".color-swatch").forEach((b) => {
    b.classList.toggle("active", b.dataset.color === (boxData.color || "#185FA5"));
  });

  const showTime = boxData.showTime !== false;
  el("showTimeToggle").setAttribute("aria-pressed", showTime ? "true" : "false");
  el("allowImageToggle").setAttribute("aria-pressed", boxData.allowImageAttach ? "true" : "false");

  el("profileBackdrop").classList.add("open");
});

el("profileCancel").addEventListener("click", () => el("profileBackdrop").classList.remove("open"));
el("profileBackdrop").addEventListener("click", (e) => {
  if (e.target === el("profileBackdrop")) el("profileBackdrop").classList.remove("open");
});

document.querySelectorAll(".preset-btn").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".preset-btn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
  });
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
    const twitterUrl = el("twitterInput").value.trim();
    const activePreset = document.querySelector(".preset-btn.active");
    const activeColor = document.querySelector(".color-swatch.active");
    const showTime = el("showTimeToggle").getAttribute("aria-pressed") === "true";
    const allowImageAttach = el("allowImageToggle").getAttribute("aria-pressed") === "true";

    const update = {
      nickname,
      twitterUrl,
      color: activeColor ? activeColor.dataset.color : (boxData.color || "#185FA5"),
      status: {
        preset: activePreset ? activePreset.dataset.preset : "근무중",
        note: el("statusNoteInput").value.trim(),
        location: el("locationInput").value.trim(),
      },
      showTime,
      allowImageAttach,
      expressions: workingExpressions,
      decorations: workingDecorations,
    };

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
  el("expressionBtn").style.backgroundImage = url ? `url(${url})` : "none";
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
    img.src = expr.imageUrl;
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
