# GitHub만 사용하는 합성 방식

**Cloudflare, R2, Vercel 가입은 필요 없습니다.**

1. 홈페이지는 공개 GitHub Pages에 유지합니다.
2. 최초 합성 시 GitHub 토큰을 브라우저 탭에 입력합니다. 이 토큰은 공개 코드에 넣지 않고 sessionStorage에만 저장합니다.
3. 승인하면 GitHub에 `AI-FairyTale-Worker` **비공개 저장소**를 자동 생성하고 `.github/workflows/render.yml` 및 `scripts/github_render.py`를 설치합니다. 기존 저장소가 있으면 재사용합니다.
4. GitHub 토큰에는 비공개 저장소 생성/Contents 쓰기/Actions 실행·읽기 권한이 필요합니다. Classic PAT를 사용한다면 repo 및 workflow 범위를 요구할 수 있습니다. 토큰은 채팅에 붙여넣지 마세요.
5. 비공개 저장소 Settings → Secrets and variables → Actions → New repository secret에서 `GEMINI_API_KEY`를 한 번 등록해야 합니다. 홈페이지에 입력한 Gemini API 키를 Actions에 자동 전달하지 않습니다.
6. 합성 버튼을 누르면 컷 MP4(각 최대 50MiB)가 비공개 GitHub 작업 브랜치에 올라갑니다. 업로드 완료 후에는 휴대폰 브라우저를 닫아도 됩니다.
7. GitHub Actions가 TTS, FFmpeg, 자막 합성, MP4 검증을 실행하고 7일 보존하는 Actions Artifact로 결과물을 전달합니다. GitHub 로그인 후 해당 실행 페이지의 Artifacts에서 내려받습니다.

**한계:** GitHub는 영상 저장 서비스가 아닙니다. 컷당 50MiB 제한, 저장소 용량·Actions 사용량 한도, 저장소 히스토리의 영상 잔존이 있습니다. 완성 후 작업 브랜치를 삭제해도 Git 객체의 즉각적인 완전 삭제가 보장되지 않습니다. 무료 사용 한도는 GitHub 계정 정책에 따릅니다. 20컷 장편·대용량 원본은 이 방식의 GitHub 용량 제한을 초과할 수 있습니다. 자막은 현재 문장 길이 비례 타이밍이며 실제 음성 단어별 정렬은 아직 구현되지 않았습니다.

**실제 동작 검증 기준:** 비공개 저장소 생성, 업로드, workflow_dispatch, Actions 실행, Artifact 다운로드를 본인 계정에서 끝까지 확인해야 운영 완료라고 말할 수 있습니다.
