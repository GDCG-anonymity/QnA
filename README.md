# 출근해도 익명으로 대화해야 하는구나 — 익명 질문함

누구나 자기 익명 질문함을 만들 수 있는 멀티 유저 구조입니다.
`index.html`(랜딩 페이지)에서 계정을 만들면 `box.html?id=본인UID`가 그 사람의 익명함이 됩니다.

## 1. Firebase 프로젝트 준비

1. https://console.firebase.google.com 에서 새 프로젝트 생성 (또는 기존 프로젝트 사용)
2. **Authentication** → 시작하기 → 로그인 방법에서 **이메일/비밀번호** 활성화
   (계정 생성은 이제 콘솔에서 수동으로 안 하고, 랜딩 페이지에서 사람들이 직접 만듭니다.)
3. **Firestore Database** → 데이터베이스 만들기 (프로덕션 모드)
4. **Firestore > 규칙** 탭에 아래 규칙을 붙여넣고 게시

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /boxes/{boxId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == boxId;

      match /questions/{qid} {
        allow read: if true;
        allow create: if (request.auth != null && request.auth.uid == boxId)
                      || (
                        request.resource.data.text is string
                        && request.resource.data.text.size() > 0
                        && request.resource.data.text.size() < 300
                        && request.resource.data.answer == null
                        && (
                          !('imageUrl' in request.resource.data)
                          || (
                            get(/databases/$(database)/documents/boxes/$(boxId)).data.allowImageAttach == true
                            && request.resource.data.imageUrl is string
                            && request.resource.data.imageUrl.size() < 400000
                          )
                        )
                      );
        allow update, delete: if request.auth != null && request.auth.uid == boxId;
      }
    }

    // 예전 단일 사용자 버전의 테스트 데이터를 옮겨오기 위한 임시 규칙.
    // migrate.html로 이관 다 끝났으면 이 블록은 지워도 됩니다.
    match /questions/{qid} {
      allow read: if request.auth != null;
    }
  }
}
```

5. **프로젝트 설정(톱니바퀴) > 일반 > 내 앱**에서 나오는 설정값을 `firebase-config.js`에 붙여넣기

## 2. 파일 구성

- `index.html` + `landing-app.js`: 소개, 익명함 생성(아이디/비밀번호/닉네임/테마), 로그인
- `box.html` + `box-app.js`: 실제 익명 질문함 화면 (`?id=` 파라미터로 어느 박스인지 구분)
- `style.css`: 공용 스타일 (두 페이지가 같이 씀)
- `firebase-config.js`: Firebase 프로젝트 설정값

## 3. 계정/아이디 방식

가입할 때 입력한 "아이디"는 내부적으로 `아이디@user.local`이라는 가짜 이메일로 변환되어
Firebase Authentication에 저장됩니다. 화면에는 아이디/비밀번호만 보이고, 실제 메일이
오가지 않는 방식이라 별도 이메일 인증 없이 바로 가입/로그인됩니다.

## 4. 지금 상태 / 아직 안 된 것

- 로그인 후 메뉴 > **프로필 설정**에서 한 화면에서 전부 관리: 닉네임, 색상, 프로필 사진, **표정 이미지 여러 장 등록**, 상태(근무중 등)+한마디+위치, 배경화면, 트위터 프로필 링크, 시간 표시 on/off, 방문자 사진 첨부 허용 on/off
- 답변 작성 화면에서 등록해둔 표정 중 하나를 골라 답변마다 다른 이미지로 보여줄 수 있음 (하나도 등록 안 하면 프로필 사진이 기본으로 쓰임)
- 방문자 사진 첨부를 켜두면 질문 입력창에 첨부 버튼이 나타나고, 방문자가 익명으로 사진을 붙여 질문할 수 있어요. 로그인 없이도 되는 대신, 신고 기능은 없어서 켜둔 상태에서 부적절한 사진이 올라오면 삭제로만 대응할 수 있어요 — 필요하면 언제든 꺼둘 수 있고, 기본값은 꺼짐이에요
- 프로필 사진/배경화면은 Storage 없이 Firestore에 축소 저장하는 방식 (사진은 240px, 배경은 480px 기준으로 자동 축소)
- 트위터 링크를 등록하면 프로필 사진을 눌렀을 때 그 링크로 이동
- 스티커 꾸미기 기능은 아직 없음 (다음 단계 후보)
- 배경화면을 올려도 반투명 흰색 막이 한 겹 깔려서 글자가 항상 읽히게 처리됨
- 초자연 재난관리국 테마는 아이보리 대신 차분한 블루 계열 배경으로 변경됨
- 사진 첨부 전송이 실패하면 이유가 알림창으로 뜨고, 성공했을 때만 입력창이 정리되도록 수정
- PC 화면(900px 이상) 한정으로 구석에 장식(사진/움짤)을 **여러 개** 올릴 수 있고, 메뉴 > 장식 위치 조정에서 화면에서 직접 각각 드래그로 위치/크기 조정 가능
- 예전 단일 사용자 버전 테스트 데이터는 `migrate.html`로 옮길 수 있습니다 (아래 6번 참고)
- `og-banner.png`: 트위터/카카오 등에 링크 공유 시 뜨는 공통 미리보기 이미지 (박스마다 다르게는 안 됨, 모든 링크가 같은 이미지 공유)

## 5. 배포 (GitHub Pages)

1. 이 폴더 전체를 저장소에 업로드 (기존 파일 덮어쓰기)
2. 저장소 Settings > Pages > Branch를 main으로 설정
3. `https://아이디.github.io/저장소이름/` 이 랜딩 페이지가 됩니다

## 6. 예전 데이터 이관 (1회용)

1. 먼저 랜딩 페이지(`index.html`)에서 본인 계정을 새로 만드세요
2. `.../migrate.html`에 접속해서 그 계정으로 로그인
3. 예전 `questions` 컬렉션에 있던 걸 자동으로 찾아서 개수를 보여줘요 — "내 익명함으로 복사하기" 누르면 지금 로그인한 계정의 익명함으로 전부 복사됩니다
4. 다 옮겼으면 `migrate.html`, `migrate-app.js` 파일은 저장소에서 지우고, Firestore 규칙에서 "예전 questions 컬렉션 임시 규칙" 블록도 지우는 걸 추천해요 (더 이상 안 쓰는 문이라 열어둘 필요 없음)

## 7. 이미지 출처

- 초자연 재난관리국 테마 로고(`disaster_logo.png`): pngtree.com의 이미지
