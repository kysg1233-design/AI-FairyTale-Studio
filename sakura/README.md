# 🌸 벚꽃 동화극장 — 매일 한 권, API 없는 자동 제작

## 운영 목표
- 매일 1권 생성 시도, 공개 책장은 검증을 통과한 완성 도서만 갱신
- 실제 완성 도서 40권 이상, 최대 100권 목표
- 후보 100편은 제작 대기열이며 완성 도서 수에 포함하지 않음
- 브라우저에서 생성 API를 호출하지 않으며, Gemini API 키나 유료 생성 API를 사용하지 않음

## 자동 제작 구성 (모두 GitHub Actions CPU 환경에서 로컬 실행)
1. **원고 각색:** Qwen2.5-3B-Instruct GGUF Q4_K_M
2. **삽화 6장:** DreamShaper 8 (Stable Diffusion 1.5 계열), 512×768, CPU 추론
3. **한국어 나레이션:** Supertonic 3 ONNX, M1 남성 / F1 여성 음성 스타일
4. **배경음:** 저장소에 포함된 5종 오리지널 무드 트랙을 장면별 mood에 따라 재생
5. **검수·게시:** 6개 본문, 6개 서로 다른 삽화, 남녀 음성 14개, 파일 형식·재생 길이·원전 중복 검사 후 책장에 등록
6. **브라우저 QA:** Chromium 데스크톱·터치 기기 시나리오 통과 후에만 공개 저장소에 반영

모델은 공개 저장소에서 파일로 내려받아 GitHub Actions 내부 CPU에서 실행합니다. 생성 추론을 외부 호스팅 API로 보내지 않습니다. 모델 다운로드와 Project Gutenberg 원전 다운로드는 일반 파일 다운로드이며 생성 API 호출이 아닙니다.

## GitHub Actions 실행
- 워크플로: `.github/workflows/sakura-daily-generate.yml`
- 매일 20:30 UTC (한국시간 다음 날 05:30) 실행
- `workflow_dispatch` 수동 실행 지원
- 코드 반영 후 첫 자동 생성 실행을 확인해야 실제 운영 시작으로 간주합니다. 현재 상태는 첫 생성 성공 미확인입니다.
- 공개 저장소 표준 Ubuntu runner는 4 vCPU / 16 GB RAM이며 GitHub 문서상 표준 runner 사용은 무료·무제한입니다. 비공개 저장소의 사양·사용량 과금은 다릅니다.
- 모델 가중치와 공개 원전 전자책 캐시는 GitHub Actions cache에 별도로 보관합니다.
- 원전 다운로드는 일반 텍스트 우선, Gutenberg HTML 및 대체 호스트 순으로 시도하며 전자책 ID별 캐시를 사용합니다. 캐시가 존재하면 네트워크 클라이언트조차 불러오지 않고 로컬 파일만 읽습니다.
- 실행 제한시간은 6시간입니다. CPU 추론이 제한시간을 넘거나 모델 다운로드·원전 추출이 실패하면 해당 날짜의 도서는 게시되지 않으며 다음 스케줄에서 재시도합니다.

## 품질과 현실적인 한계
- GPU 없이 CPU로 실행하므로 고성능 GPU 기반 생성보다 느립니다.
- DreamShaper 8은 SD 1.5 계열 모델로, 생성 해상도는 512×768입니다. '고품질' 목표로 구성했지만 GPU 기반 SDXL급 결과를 보장하지 않습니다.
- Qwen 3B는 로컬 경량 모델이므로 원전 각색에 오류가 있을 수 있습니다. 자동 검수는 길이·구조·파일 무결성 검사이며 사람의 문학적 편집 검수를 대체하지 않습니다.
- 생성 결과가 기준에 미달하면 불완전한 패키지를 공개 책장에 올리지 않습니다.
- Supertonic 소스 코드와 가중치는 현재 공개 아카이브 상태이며 추가 개발·공식 지원이 종료되었습니다. 코드(MIT)와 모델(OpenRAIL-M) 라이선스 조건을 따릅니다. DreamShaper 모델은 CreativeML OpenRAIL-M, Qwen2.5 모델은 해당 모델 저장소의 라이선스 조건을 따릅니다. 모델 사용 전 각 라이선스의 제한사항을 준수합니다.

## 패키지 구조
```
sakura/incoming/<daily-package>/
  book.json
  assets/
    cover.webp
    page-01.webp ... page-06.webp
    male-01.mp3 ... male-06.mp3
    female-01.mp3 ... female-06.mp3
    male-title.mp3
    female-title.mp3
```
가져오기 스크립트는 페이지별 160자 이상 본문, 6장의 서로 다른 WEBP 삽화, 남녀 음성 12개와 제목 음성 2개를 검사합니다. 검사 실패 시 공개 목록을 갱신하지 않습니다.

## 저작권
원전 제목·출처·URL을 책마다 보존합니다. Project Gutenberg에 수록됐다는 사실만으로 모든 국가에서 저작권이 만료됐다고 단정하지 않습니다. 작품별 저작권 상태를 확인하고, 현대 번역문이나 제3자 삽화를 복제하지 않습니다.

## 홈페이지
https://kysg1233-design.github.io/AI-FairyTale-Studio/sakura/

## 현재 검증 상태
`books/index.json`에는 기존 완성 도서 5권이 있습니다. 자동 생성 코드는 main에 반영됐지만, `build-status.json`의 `configured_pending_first_generation` 상태가 성공 영수증으로 바뀌기 전까지는 매일 생성이 실제로 성공한다고 간주하지 않습니다.
