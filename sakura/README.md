# 🌸 벚꽃 동화극장 — 사전 제작형 그림책

## 운영 구조: 생성과 배포를 완전히 분리
- 독서·홈페이지 접속 중 외부 생성 API 호출 없음
- GitHub Actions 자동 검증·게시에는 Gemini API 키가 필요 없음
- 삽화·남녀 나레이션·제목 음성은 완성 패키지로 준비한 뒤, 검증 통과한 책만 공개 책장에 등록
- 기존 완성 도서 5권 보존. 후보 100편은 후보이며 완성 도서 수에 포함하지 않음
- 목표: 실제 완성 도서 40권 이상, 최대 100권

## 완성 도서 패키지 구조
```
sakura/incoming/<book-slug>/
  book.json
  assets/
    cover.webp
    page-01.webp ... page-06.webp
    male-01.mp3 ... male-06.mp3
    female-01.mp3 ... female-06.mp3
    male-title.mp3
    female-title.mp3
```
book.json은 books/index.json의 도서 항목과 같은 메타데이터 구조입니다. 단, 이미지·음성 경로는 패키지 안의 파일명으로 작성합니다. pages는 정확히 6개여야 하며 각 페이지에 heading, text가 필요합니다. title, region, source_title, source_url, source_credit, parent_moral도 필요합니다.

완성 패키지가 저장소에 추가되면 sakura-offline-publish.yml이 실행됩니다. 이미지 형식·해상도·중복, MP3 파일·재생 길이, 본문 완결성, 원전 중복을 검사하고 데스크톱·Galaxy 모바일 브라우저 QA까지 통과해야만 공개 책장에 등록합니다. 불완전 패키지는 게시하지 않습니다.

## Gemini 구독과 API
Gemini 앱의 유료 구독은 GitHub Actions에서 자동으로 사용할 수 있는 API 인증이 아닙니다. 이 구조에서는 Actions가 Gemini API를 호출하지 않으므로 별도 API 크레딧이나 GEMINI_API_KEY 없이 검증·게시할 수 있습니다. 단, 완성된 삽화와 실제 남녀 음성 파일은 패키지에 포함되어야 합니다. 브라우저 TTS를 실제 음성 파일인 것처럼 위장하거나 하나의 음성을 남녀 파일로 복제하지 않습니다.

## 홈페이지
https://kysg1233-design.github.io/AI-FairyTale-Studio/sakura/
손가락 책장 넘김은 StPageFlip 엔진, 배경음은 5개 분위기별 사전 제작 트랙을 사용합니다. 실제 음성 재생은 브라우저 정책상 사용자 제스처 후 시작될 수 있습니다.

## 저작권·품질
원전 링크와 출처를 각 책에 기록합니다. Project Gutenberg 원전의 지역별 저작권 상태는 작품별로 확인해야 합니다. 현대 번역문·타인의 삽화를 복제하지 않습니다. 자동 검사는 편집 검수를 대체하지 않습니다.
