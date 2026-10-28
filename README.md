# K-aption FE

영어 강의 파일을 업로드하고 서버가 생성한 한국어·영어 자막과 함께 재생하는 React 프론트엔드입니다. Docker에서 실행 중인 K-aption Jobs API에 실제 파일을 전송합니다.

- 저장소: https://github.com/Raising-Lee-Hyun-seong/K-aption_FE
- 백엔드: https://github.com/Raising-Lee-Hyun-seong/K-aption_BE
- 기술 스택: React, TypeScript, Vite
- 연결 규격: 실행 서버의 OpenAPI `/openapi.json`과 Jobs API

## 현재 범위

| 기능 | 상태 |
| --- | --- |
| 서버·번역/STT 모델 상태 조회 | `/health` 연결 |
| 업로드 형식·용량·길이 검사 | `/api/v1/capabilities`의 실제 서버 규칙 사용 |
| 영상·음성 파일 업로드 | multipart `file`, 영어 `language=en`으로 작업 접수 |
| 처리 상태 표시 | 서버가 반환한 단계와 구간 수를 2초 간격으로 조회 |
| 번역 진행률 | 서버의 `progress_percent` 사용. `null`이면 퍼센트 표시 안 함 |
| 실행 중 작업 취소 | 서버의 취소 완료까지 확인 |
| 자막 재생·언어 전환·구간 이동 | 실제 `/result` 응답 사용 |
| SRT/VTT 다운로드 | 선택한 한국어·영어·한영 모드로 서버에서 다운로드 |
| 새로고침 후 최근 작업 복원 | 작업 ID와 원본 파일명·크기를 로컬 저장소에 기록 |
| 원본 영상·음성 재생 | 선택한 로컬 파일 사용. 새로고침 후 동일 파일 재선택 필요 |
| 용어집 선택·편집 | 서버 미지원. 선택 UI 비활성화 |

목 어댑터와 고정 자막은 제거했습니다. 테스트에서만 서버 응답 대역을 사용하며 제품 화면은 실제 API만 호출합니다.

## 실행 준비

현재 PC의 폴더는 `C:\K-caption\K-aption_FE`입니다. Docker Desktop에서 백엔드와 번역 컨테이너가 실행 중이어야 합니다. 백엔드가 이미 실행 중이면 프론트엔드만 실행하면 됩니다.

```powershell
cd C:\K-caption\K-aption_FE
npm ci
npm run dev
```

브라우저에서 `http://localhost:5173/`을 엽니다. 기존 Vite 서버가 실행 중이었다면 `Ctrl+C`로 종료하고 다시 실행해 프록시 설정을 적용합니다.

백엔드 상태는 다음 주소에서 확인할 수 있습니다.

- 상태: http://localhost:8000/health
- 업로드 규칙: http://localhost:8000/api/v1/capabilities
- API 규격: http://localhost:8000/openapi.json

새 환경에서 저장소를 받을 때:

```powershell
git clone https://github.com/Raising-Lee-Hyun-seong/K-aption_FE.git
cd K-aption_FE
npm ci
npm run dev
```

## Docker 서버 주소 설정

기본 개발 연결은 다음과 같습니다.

```text
브라우저 http://localhost:5173
  → Vite /api 및 /health 프록시
  → http://127.0.0.1:8000
  → Docker backend의 공개 포트 8000
```

같은 PC의 포트 8000을 사용하면 별도 설정이 필요 없습니다. 다른 포트나 서버를 사용할 때 `.env.example`을 `.env.local`로 복사하고 수정합니다.

```powershell
Copy-Item .env.example .env.local
```

```dotenv
API_PROXY_TARGET=http://127.0.0.1:8000
VITE_API_BASE_URL=
```

| 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `API_PROXY_TARGET` | `http://127.0.0.1:8000` | Vite가 접근하는 Docker 백엔드 공개 주소 |
| `VITE_API_BASE_URL` | 빈 값 | 브라우저가 직접 호출할 별도 API 원점. 빈 값이면 같은 원점 사용 |

개발 프록시를 사용하면 브라우저의 별도 CORS 설정 없이 연결됩니다. `VITE_API_BASE_URL`에 별도 원점을 지정하면 백엔드가 프론트엔드 원점을 CORS로 허용해야 합니다. Docker 내부 서비스 이름인 `backend`나 `translator`를 일반 브라우저 주소로 사용하지 않습니다.

`npm run build`로 만든 `dist/`에는 Vite 개발 프록시가 포함되지 않습니다. 배포 서버에서 `/api`와 `/health`를 백엔드로 전달하는 역방향 프록시를 설정하거나, 빌드 전에 `VITE_API_BASE_URL`을 지정하고 백엔드 CORS를 맞춰야 합니다.

## 화면과 처리 흐름

1. `/health`와 `/api/v1/capabilities`로 서버 상태와 허용 파일 규칙을 읽습니다. 규칙을 받지 못하면 업로드 시작을 막고 재연결 버튼을 표시합니다. STT 모델의 `false`는 첫 요청 전일 수 있어 업로드를 막는 조건으로 사용하지 않습니다.
2. 파일 선택 또는 드래그 앤 드롭으로 원본을 고릅니다. 확장자·빈 파일·최대 바이트·확인 가능한 길이를 검사합니다. 브라우저에서 길이를 읽을 수 없어도 최종 검증은 서버가 수행합니다.
3. `POST /api/v1/jobs?language=en`에 `FormData`의 `file` 필드로 업로드합니다. `Content-Type`은 브라우저가 multipart 경계와 함께 설정합니다. 업로드 접수 중에는 홈 이동을 비활성화합니다.
4. HTTP 202 응답에서 받은 `job_id`를 저장합니다. 이후 `GET /api/v1/jobs/{job_id}`를 2초 간격으로 조회합니다. 이전 조회가 끝난 뒤 다음 조회를 예약하므로 요청이 겹치지 않습니다.
5. `completed`이면 `/result`를 읽어 재생 화면으로 이동합니다. `failed`이면 서버 실패 메시지를, `cancelled`이면 취소 완료 안내를 표시합니다.
6. 한국어·English·한·영 버튼은 재생 시각을 유지합니다. 자막 카드 클릭 또는 Enter/Space는 해당 시작 시각으로 이동합니다.

현재 클라이언트는 상태 조회를 사용하며 SSE `/events` 구독은 사용하지 않습니다. 서버 단계는 `queued → transcribing → grouping → translating → completed`입니다. 화면에서 서버가 제공하지 않는 음성 추출 등의 세부 진행률을 추정하지 않습니다. 표시하는 퍼센트는 전체 작업 시간이 아닌 **번역 구간 처리 비율**입니다.

## 취소·재접속·미디어 복원

- 취소는 `POST /api/v1/jobs/{job_id}/cancel`을 사용합니다. `cancelling`은 취소 요청 상태이므로 완료로 표시하지 않습니다. 서버가 `cancelled`를 반환할 때까지 조회합니다.
- 접수 이후 홈으로 이동해도 서버 작업은 계속됩니다. 홈의 `최근 작업 다시 보기` 또는 새로고침으로 마지막 작업을 다시 조회합니다.
- 로컬 저장소에는 마지막 작업의 ID·파일명·크기만 저장합니다. 원본 파일 바이트나 자막 본문을 저장하지 않습니다. 저장소 사용이 차단된 브라우저에서는 새로고침 복원이 제한됩니다.
- 서버에 원본 미디어 조회 API가 없어 원본 재생은 `URL.createObjectURL(file)`로 합니다. 새로고침한 결과 화면에서 파일명과 크기가 같은 원본을 다시 골라야 합니다. 이 검사는 파일 내용 해시 검증은 아닙니다.
- 작업을 찾지 못하는 HTTP 404는 만료 또는 없는 작업으로 안내하고 저장한 작업 참조를 지웁니다. 결과 보관 기한은 서버의 `expires_at`을 표시합니다.
- 상태 조회가 끊기면 작업 ID를 유지하고 `상태 다시 확인`을 제공합니다. 파일 업로드 POST는 자동 재시도하지 않습니다. 업로드 중 연결이 끊기면 서버가 접수했는지 알 수 없기 때문입니다.

## 자막 API 계약

`GET /api/v1/jobs/{job_id}/result`의 `segments`를 화면 모델로 정규화합니다.

| 서버 필드 | 프론트엔드 필드 | 처리 |
| --- | --- | --- |
| 배열 순서 | `id` | 응답 내 임시 구간 ID 생성 |
| `start`, `end` | `startMs`, `endMs` | 초에 1,000을 곱해 밀리초로 변환 |
| `text` | `sourceText` | 영어 원문 |
| `translation` | `targetText` | 한국어 번역 |
| `translation_error` | `status` | 실패 시 영어 원문과 실패 배지 표시 |

`translation=null` 또는 `translation_error=translation_failed`이면 해당 구간의 영어 원문을 유지합니다. 빈 `segments`는 인식된 음성이 없는 결과이며 미디어 조작은 유지합니다.

자막 다운로드는 다음 경로를 사용합니다.

```http
GET /api/v1/jobs/{job_id}/subtitles?format=srt&language=ko&download=true
```

`format`은 `srt|vtt`, `language`는 `ko|en|both`입니다. 다운로드 실패는 재생 화면 안에 안내하고 현재 재생을 유지합니다.

## 오류 처리

| 상태 | 화면 동작 |
| --- | --- |
| 404 | 작업 없음·만료 안내 |
| 409 | 현재 상태에서 요청 불가 안내. 취소 충돌이면 최신 작업 상태 재조회 |
| 413 | 파일 크기 초과 안내 |
| 415 | 지원하지 않는 형식 안내 |
| 422 | 길이·디코딩·요청 검증 오류 안내 |
| 500 | 처리·저장 오류 안내 |
| 503 | 작업자 준비 또는 대기 한도 안내 |
| 연결 실패·응답 시간 초과 | 재연결 안내. 기존 접수 작업은 재전송하지 않음 |

`detail` 문자열과 FastAPI 검증 오류 배열을 처리합니다. JSON이 아닌 오류 응답은 HTTP 상태에 맞는 메시지로 표시합니다. 작업 응답의 `error.message`도 실패 안내에 사용합니다.

## 주요 파일

| 파일 | 역할 |
| --- | --- |
| `src/App.tsx` | 업로드·처리·오류·재생, 작업 복원과 사용자 조작 |
| `src/api/jobApiAdapter.ts` | HTTP 요청, 규격 확인, 응답·오류 정규화 |
| `src/types.ts` | API 어댑터와 화면이 사용하는 타입 |
| `vite.config.ts` | Docker 공개 포트로 개발 요청 프록시 |
| `.env.example` | 개발·배포 주소 설정 예시 |
| `src/styles.css`, `src/api.css` | 기본 UI와 API 상태·다운로드 반응형 스타일 |
| `tests/api-flow.spec.ts` | 응답 대역을 사용한 브라우저 회귀 테스트 |
| `tests/live-api.spec.ts` | 선택적으로 실제 서버에 미디어를 업로드하는 통합 검사 |

## 검증

```powershell
npm run typecheck
npm run build
npm test
```

브라우저 테스트는 설치된 Microsoft Edge를 사용합니다. 기본 테스트는 실제 추론을 실행하지 않습니다. 실제 백엔드를 검증하려면 영어 음성 또는 영상 파일 경로를 지정합니다. 이 검사는 서버에 파일을 업로드하고 작업을 생성합니다.

```powershell
$env:KAPTION_LIVE_MEDIA='C:\path\lecture.wav'
npx playwright test tests/live-api.spec.ts
Remove-Item Env:KAPTION_LIVE_MEDIA
```

타입·빌드 성공은 모델의 번역 품질을 보장하지 않습니다. 번역 검증 실패 구간은 재생 화면에 표시되며 의미 정확도 평가는 별도로 수행해야 합니다.
