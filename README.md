# K-aption 프론트엔드 데모

React + TypeScript + Vite로 만든 로컬 데모입니다. 백엔드 요청이나 실제 음성 인식·번역은 수행하지 않습니다.

## 실행

```powershell
cd C:\K-caption
npm install
npm run dev
```

브라우저에서 `http://localhost:5173`을 엽니다. `npm run typecheck`와 `npm run build`로 검증할 수 있습니다.

## 데모 범위

- 로컬 mp4, mkv, mp3, wav 파일 선택과 드래그 앤 드롭
- 브라우저에서 읽을 수 있는 재생 길이에 대한 90분 초과 검사
- 용어집 선택 및 정상 완료·일부 번역 실패·자막 없음·처리 실패 시나리오
- 시연용 단계 진행률과 고정 영·한 자막. 자막은 업로드한 파일의 실제 음성과 관계없습니다.
- 선택한 로컬 파일의 현재 탭 내 재생, 자막 모드 전환, 자막 카드 클릭 이동

브라우저가 파일 길이 또는 코덱을 읽지 못하면 안내 문구를 표시합니다. mkv 재생은 브라우저의 코덱 지원 여부에 따릅니다. 새로고침 후 작업 복원, 서버 저장, 다운로드, 용어집 편집은 제공하지 않습니다.

`src/types.ts`의 `ApiClient`와 `src/api/mockAdapter.ts`가 데이터 경계입니다. 향후 REST API를 연결할 때 이 경계에서 응답을 `JobView`와 `SubtitleSegment`로 변환하면 화면 컴포넌트는 그대로 사용할 수 있습니다.
