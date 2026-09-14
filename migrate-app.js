const EMAIL_DOMAIN = "user.local";

firebase.initializeApp(window.firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const el = (id) => document.getElementById(id);

el("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = el("loginId").value.trim();
  const pw = el("loginPw").value;
  el("loginErrorLanding").hidden = true;
  try {
    await auth.signInWithEmailAndPassword(`${id}@${EMAIL_DOMAIN}`, pw);
    el("loginForm").hidden = true;
    await loadOldQuestions();
    el("migrateSection").hidden = false;
  } catch (err) {
    el("loginErrorLanding").textContent = "아이디 또는 비밀번호가 올바르지 않아요.";
    el("loginErrorLanding").hidden = false;
  }
});

let oldDocs = [];

async function loadOldQuestions() {
  const snap = await db.collection("questions").get();
  oldDocs = snap.docs;
  el("oldCount").textContent = oldDocs.length;
}

el("migrateBtn").addEventListener("click", async () => {
  el("migrateError").hidden = true;
  el("migrateBtn").disabled = true;
  el("migrateBtn").textContent = "복사 중...";

  const uid = auth.currentUser.uid;
  const boxQuestions = db.collection("boxes").doc(uid).collection("questions");

  let successCount = 0;
  let failCount = 0;

  for (const doc of oldDocs) {
    const data = doc.data();
    try {
      await boxQuestions.doc(doc.id).set({
        text: data.text || "",
        createdAt: data.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
        answer: data.answer || null,
        answeredAt: data.answeredAt || null,
      });
      successCount += 1;
    } catch (err) {
      failCount += 1;
    }
  }

  if (failCount > 0) {
    el("migrateError").textContent =
      `${successCount}개 복사, ${failCount}개는 실패했어요. Firestore 규칙이 최신 버전으로 게시됐는지 확인한 뒤 다시 시도해보세요 (같은 항목은 덮어써질 뿐 중복되지 않아요).`;
    el("migrateError").hidden = false;
    el("migrateBtn").disabled = false;
    el("migrateBtn").textContent = "다시 시도";
  } else {
    el("migrateDone").hidden = false;
    el("doneCount").textContent = successCount;
    el("migrateBtn").hidden = true;
  }
});
