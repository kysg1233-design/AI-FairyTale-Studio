# 🌸 벚꽃 동화극장 — 사전 제작형 그림책

**독서 중 Gemini API를 호출하지 않습니다.** 그림책을 공개하기 전에 원전 확인·한국어 각색·장면별 그림·남녀 음원·검증을 끝냅니다.

## GitHub Pages
- 배포 폴더: `/sakura/`
- 예상 URL: https://kysg1233-design.github.io/AI-FairyTale-Studio/sakura/
- GitHub Settings → Pages → Build and deployment → GitHub Actions
- 페이지를 손가락으로 잡아 끌어 넘기는 StPageFlip 엔진을 사용합니다.
- 책을 열기 전에 **해당 책의 모든 그림과 선택한 남녀 음성 파일을 다운로드·이미지 디코드**합니다. 책을 여는 중 일부 파일이 실패하면 책을 열지 않습니다.
- 나레이션 기본 ON, 기본 남성 Charon / 여성 Leda, 배경음 기본 ON. 실제 오디오 자동 재생은 브라우저 정책상 사용자 제스처가 필요할 수 있습니다.

## 주간 완제품 자동 생성
- 목록: `books/candidates.json` (61편, 현재 *후보*이며 공개 도서가 아닙니다)
- 일정: 매주 월요일 오전 9:05 **한국 시간** (UTC 월요일 00:05)
- Actions: `sakura-weekly.yml`
- 보안: **GitHub Repository Settings → Secrets and variables → Actions → New repository secret → `GEMINI_API_KEY`** 생성. 기존 영상 스튜디오 브라우저에만 저장된 키는 GitHub Actions에서 읽을 수 없습니다. 공개 소스코드에는 비밀키를 넣지 마세요.
- Actions 탭에서 `Weekly complete Sakura storybook publishing` → `Run workflow`로 첫 제작을 수동 실행할 수 있습니다.
- API 모델은 텍스트 `gemini-2.5-flash`, 삽화 `gemini-2.5-flash-image`, 음성 `gemini-3.8-flash-lite-tts`. 모델 이용 가능 여부, 할당량, 과금은 API 계정마다 달라집니다.

## 완료 검증
`publish_weekly.py`는 원전 제목에 해당하는 실제 본문을 찾지 못하면 중단합니다.
한 권은 6장면으로 제작하며 다음이 준비되어야 `books/index.json`에 추가됩니다:
- `cover.webp`
- `page-01.webp` ~ `page-06.webp` (중복/유사 이미지 검사)
- `male-01.mp3` ~ `male-06.mp3`
- `female-01.mp3` ~ `female-06.mp3`
- `manifest.json`, 원전 링크와 현대 한국어 각색 본문
- `python sakura/check_site.py` 정적 검사 통과

**중요:** 아직 제작된 완성 도서가 없다면 홈페이지 책장은 비어 보입니다. 이것이 의도된 품질 게이트이며, 미완성 SVG나 브라우저 TTS를 대신 표시하지 않습니다.

## 저작권
후보 원전은 Project Gutenberg와 도서관 등에서 확인한 초기 출판본입니다. 미국 퍼블릭 도메인 여부와 한국 등 각 지역에서의 저작권은 다를 수 있습니다. 원전 텍스트를 새로 각색하며 현대 번역이나 타인의 삽화는 복사하지 않습니다. 원전 출처를 각 책에 표시합니다. 한국 소재 이야기 중 일부는 현대 창작자에 의해 각색된 변형이 있으므로 작품별로 검토해야 합니다.

## 현재 제한
- GitHub secret을 별도로 등록해야 AI 제작을 실행할 수 있습니다.
- Gemini가 원전 의미와 등장인물을 정확히 반영했는지, 부적절한 장면이 없는지는 자동 검사만으로 완벽히 보장할 수 없어 공개 전 편집 검수가 권장됩니다.
- 일주일 단위 자동화는 GitHub Actions 일정에 따르며 정확한 시각의 실행을 보장하지 않습니다.
