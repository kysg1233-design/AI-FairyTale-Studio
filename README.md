# 몽글몽글 — AI 동화 제작 스튜디오

새로운 3단계 AI 동화 영상 제작 스튜디오입니다.

- 동화 입력 (1~10컷)
- 캐릭터·장면·Veo 프롬프트와 한국어 나레이션 생성
- Veo에서 제작한 영상 업로드 및 최종 영상 합성

현재 이 저장소는 **공개 홈페이지와 Cloudflare Worker 소스만** 포함합니다. 실제 기능을 사용하려면 Cloudflare Workers/R2/Gemini API와 별도의 비공개 합성 작업 저장소를 연결해야 합니다. API 키와 개인 영상은 이 공개 저장소에 저장하지 않습니다.

## GitHub Pages

Settings → Pages → Deploy from a branch → main → /(root)

## 상태

코드 등록 단계입니다. 실제 배포·Gemini·업로드·MP4 합성 테스트는 아직 완료되지 않았습니다.
