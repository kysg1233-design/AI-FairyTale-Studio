# 서버 합성 연결 상태와 필수 설정

이 저장소의 GitHub Pages는 **정적 웹사이트**입니다. GitHub Pages만으로는 사용자의 MP4를 안전하게 받아 GitHub Actions에 넘길 수 없습니다.

## 실제 실행 경로
1. 웹페이지에서 완성된 프롬프트와 선택한 MP4를 Worker API로 전달합니다.
2. Worker가 비공개 Cloudflare R2 버킷의 짧은 수명 업로드 URL을 발급합니다.
3. 브라우저는 MP4를 R2로 직접 업로드하고 각 컷의 업로드 완료를 확인합니다.
4. Worker가 **별도의 비공개 GitHub 저장소**에 `workflow_dispatch`를 전송합니다. 브라우저는 GitHub 토큰을 보지 않습니다.
5. Actions의 `scripts/render.py`가 R2 원본을 읽어 TTS, 자막, 합성을 수행하고 MP4를 R2로 업로드합니다.
6. 브라우저가 작업 상태를 조회하고 완성본의 짧은 수명 다운로드 URL을 표시합니다. 업로드 후에는 크롬을 닫아도 됩니다.

## 아직 외부 계정에서 필요한 연결
- Cloudflare R2의 비공개 `fairytale-private-videos` 버킷과 Worker 배포. R2 사용량/요금은 Cloudflare 계정 조건에 따르므로 **무조건 무료라고 보장할 수 없습니다**.
- Worker의 환경 변수 및 비밀값: `STUDIO_ACCESS_KEY`, `GEMINI_API_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `GITHUB_ACTIONS_TOKEN`, `WORKER_JOB_KEY`.
- **비공개** `kysg1233-design/AI-FairyTale-Worker` 저장소 생성 후 이 저장소의 `renderer/render.yml`을 `.github/workflows/render.yml`로, `renderer/scripts/render.py`를 `scripts/render.py`로 복사. Worker가 가리키는 저장소 이름과 일치해야 합니다.
- 비공개 저장소 Actions secrets: `WORKER_URL`, `WORKER_JOB_KEY`, `GEMINI_API_KEY`. `GITHUB_ACTIONS_TOKEN`은 해당 비공개 저장소 workflow dispatch 권한이 있어야 합니다.
- `worker/wrangler.toml`의 계정 ID와 R2 버킷 바인딩 설정 후 Worker 배포.
- Worker `/health`에서 `ready:true`가 확인되기 전에는 서버 합성을 사용하지 마세요.

**보안:** 비밀값을 GitHub Pages `config.js`, 공개 저장소, 채팅에 붙여넣지 마세요. Worker에 넣은 스튜디오 접근키는 브라우저 세션에서만 입력합니다.

현재 소스 코드 변경만으로 외부 계정의 R2/Worker/비공개 저장소가 자동으로 생성되거나 설정되지는 않습니다. 브라우저의 서버 합성 버튼은 연결이 준비되지 않았으면 명확한 오류를 표시하고 기존 MP4를 재제작하지 않습니다.
