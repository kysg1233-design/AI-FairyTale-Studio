# 몽글몽글 · AI 동화 영상 제작 스튜디오

**기존 AI-Baby-studio와 별개의 새 프로젝트입니다.** 모바일 우선 3단계 UI, Gemini 프롬프트 생성, Veo 수동 영상 제작, 컷별 R2 업로드, 비공개 GitHub Actions의 FFmpeg/한국어 TTS 합성을 목표로 합니다.

## 진행 상태 (검증은 각각 독립적으로 확인)
- [x] 공개 GitHub 저장소 및 홈페이지 코드 등록
- [x] GitHub Pages 자동 배포 워크플로 등록
- [ ] GitHub Pages 공개 URL에서 실제 화면 확인
- [ ] Cloudflare R2/Workers 배포 및 연결
- [ ] Google Gemini 실제 프롬프트 응답 검증
- [ ] 개인 영상 파일 업로드/삭제 실환경 검증
- [ ] 별도 **Private** 저장소에 렌더러 배포
- [ ] Gemini 한국어 TTS 및 영상 합성 실환경 검증
- [ ] 2컷 → 10컷 완성 MP4 다운로드 검증

UI는 서버가 연결되지 않으면 생성·합성을 **작동하는 척하지 않고** 오류를 보여줍니다.

## 실제 구조

```
GitHub Pages / ① 동화 입력 → ② 프롬프트 → ③ 영상 업로드·완성
    ↕ 인증된 API (Cloudflare Workers)
Gemini 2.5 Flash + Private R2 bucket + R2 job state
    → GitHub Actions workflow_dispatch (별도의 PRIVATE 저장소)
        → Gemini 2.5 Flash TTS + FFmpeg
        → Private R2 최종 MP4
```

- `index.html`, `style.css`, `app.js`, `config.js`: 공개 홈페이지
- `worker/`: Cloudflare Workers API 소스 (비밀값 없음)
- `renderer/scripts/render.py` 와 `renderer/render.yml`: **비공개 저장소로 복사할 소스 템플릿**, 공개 저장소에서 실행하지 않음
- `.github/workflows/pages.yml`: 공개 홈페이지 배포. 이 워크플로는 홈페이지 파일만 배포합니다.

## 비밀값 보호 (중요)
어떤 API 비밀키도 GitHub Pages JS, 공개 저장소, 이 README 또는 GitHub Actions 워크플로 입력값에 넣지 마세요.

Cloudflare Workers의 Secrets에는 다음을 등록해야 합니다.
- `STUDIO_ACCESS_KEY`: 사용자만 아는 긴 랜덤 개인 스튜디오 접근키
- `GEMINI_API_KEY`: Google AI Studio Gemini API 키
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: **전용 비공개 R2 bucket** 접근 자격증명
- `GITHUB_ACTIONS_TOKEN`: 별도 PRIVATE 저장소의 Actions(write) 권한을 가진 fine-grained PAT
- `WORKER_JOB_KEY`: Private Actions 작업과 Workers 내부 콜백에서만 공유하는 별도 긴 랜덤 키

Private GitHub Actions 저장소의 Secrets에는 `WORKER_URL`, `WORKER_JOB_KEY`, `GEMINI_API_KEY`가 필요합니다.
프런트엔드 `config.js`에는 **공개 Workers URL**만 입력하며 비밀키를 넣지 않습니다.

Cloudflare Workers `wrangler.toml`의 `R2_ACCOUNT_ID`는 실제 계정 ID로 교체해야 합니다. 프로젝트·진행 상태 메타데이터도 비공개 R2에 저장하며 별도 KV 설정은 필요하지 않습니다.
Cloudflare에 Private R2 bucket `fairytale-private-videos`와 KV namespace를 만들고 R2 bucket CORS를 `worker/r2-cors.json`으로 설정하세요.

### 영상 업로드 제한
파일당 최대 1GiB, MP4/MOV/WebM/M4V. 서명된 단일 PUT(15분 만료)을 사용하며 브라우저가 원본 파일을 Workers에 중계하지 않고 R2에 직접 전송합니다. 네트워크가 끊길 경우 동일 컷을 다시 선택해서 재시도합니다. 매우 느린 업로드에는 향후 multipart 지원이 필요할 수 있습니다.

### 동화 새로 시작과 삭제
`새 동화 시작`은 현재 브라우저의 작업 화면을 초기화합니다. **서버의 과거 제작 내역은 삭제하지 않습니다.**
`제작 내역 삭제`는 서버에 실제 삭제 요청을 보내고 성공할 때만 화면에서 제거합니다. 비공개 R2 원본 영상과 완성본도 삭제합니다. 합성이 진행 중이면 삭제를 거부합니다. Cloudflare/GitHub 플랫폼 백업·별도 로그 등은 그 플랫폼의 보존 정책에 따릅니다.

## 다음 단계
1. GitHub Pages 활성화 및 실제 URL 확인.
2. Cloudflare 계정/R2/Workers 생성 (외부 계정 소유자 승인 필요).
3. 비공개 `AI-FairyTale-Worker` 저장소 생성 및 renderer 파일 추가.
4. 키를 사용자가 직접 Cloudflare Secret / private GitHub Actions Secret에 등록.
5. 2컷 샘플로 프롬프트→컷별 업로드→합성→MP4 파일 검증, 그다음 10컷.

설정 화면을 매번 보여 달라는 것이 아니라 실제 권한 승인이 필요할 때만 한 단계씩 진행합니다.
