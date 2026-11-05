# 첫 승차 지점까지의 보행 기록

## 범위

카카오 대중교통 상세에서 사용자가 **안내 시작**을 누른 뒤 첫 버스 정류장 또는 확인된 지하철 출입구까지의 도보만 기록한다. 검색·카드 선택은 기록을 시작하지 않는다. 모든 환경에서 카카오 UI를 사용하며 기존 도보 안내는 유지한다.

환승·하차 도보 자동 시작, 버스·열차 탑승 판별, 승강장 도착 판별은 구현하지 않는다.

## 구현 파일

- `src/services/navigation/transitAccessArrival.ts`: 기존 승차 지점 증거에서 목표 좌표 선택, 도착 판정 정책.
- `src/services/navigation/transitAccessRecording.ts`: 기존 기록 서비스의 시작·종료 제어, 중복 방지, 로컬 저장·해당 세션 동기화 확인.
- `src/features/transit/useTransitAccessRecording.ts`: Measurement/Sync 컨텍스트, 화면 복귀·GPS 단절 상태 연결.
- `src/features/transit/TransitAccessRecordingStatus.tsx`: 안내 시작·종료와 저장 결과 표시.
- `src/features/transit/KakaoTransitRoutePanel.tsx`: 상세 안내 연결, 안내 중 다른 경로 선택 제한, 목록에서도 안내 상태 유지.
- `src/features/map/TransitRouteMap.tsx`: 경로 전체를 다시 만들지 않고 GPS 마커 갱신.
- `src/features/measurement/measurementContext.ts`, `MeasurementProvider.tsx`, `measurementManager.ts`: 기존 매니저의 동기 상태 읽기·시작 메타데이터 연결, 종료 중 늦은 GPS 차단.
- `src/repositories/local/localMeasurementRepository.ts`: 기존 시작 이벤트 JSON 메타데이터 보존.
- `src/pages/WalkingRoutePage.tsx`: 사용자 변경 시 대중교통 화면과 안내 수명을 분리.
- 자동화 테스트: `transitAccessArrival.test.ts`, `transitAccessRecording.test.ts`, `TransitRouteMap.test.tsx`, `KakaoTransitRoutePanel.test.tsx`, `router.test.tsx`.

## 재사용과 저장 흐름

- G9와 같은 `MeasurementProvider.startMeasurement('navigation')`, `subscribeGps`, `stopMeasurement`를 사용한다. GPS watch를 별도로 생성하지 않는다.
- G2의 원본 GPS 저장 큐, IndexedDB 트랜잭션, 소유권 검사, 동기화 대기 항목을 그대로 사용한다.
- 시작 이벤트의 기존 `details` JSON에 `guidanceId`, `transitRouteId`, `walkingScope=first_boarding_access`, 목표의 출처와 이름을 남긴다. 새 DB 테이블·컬럼은 없다.
- 자동 종료는 G2가 도착 판정에 사용한 마지막 GPS 원본을 저장 큐에 넣은 뒤 실행한다. 종료 중 늦게 들어온 GPS 콜백은 기록에 추가하지 않는다.
- 종료 후 동일 사용자의 해당 세션이 실제로 `completed`인지와 로컬 GPS 저장 결과를 확인한다. 로컬 확인 실패나 일부 GPS 저장 실패는 저장 완료로 표시하지 않는다.
- 서버 완료는 해당 세션에 연결된 동기화 항목이 모두 `confirmed`일 때만 표시한다. 전역 동기화 완료를 해당 기록의 서버 저장 완료로 대신하지 않는다.
- 완료 세션은 기존 기록 목록·G6·G7 입력 흐름에 들어간다. 짧은 기록이나 표본 부족 등 기존 학습 제외 조건은 바꾸지 않았다.

## 좌표와 도착 판정

`transitAccessArrivalPolicy`에서 다음 값을 관리한다.

| 조건 | 값 |
|---|---|
| 도착 반경 | 40m |
| GPS 정확도 | 30m 이내 |
| 연속 유효 관측 | 3개 |
| 관측 최대 나이·연속 간격 | 15초 |
| 판정에 사용할 관측 사이 최소 간격 | 1초 |
| 위치 도약 보류 기준 | 초당 6m + 두 관측의 정확도 범위 |

위치 도약 기준은 자동 도착 판정 전용이며 G6/G7의 품질·속도 정책을 변경하지 않는다. 같은 시각·이전 시각 관측은 도착 횟수를 늘리지 않는다. 정확도 부족·수신 단절·화면 숨김 후에는 연속 판정을 다시 시작한다.

좌표는 정류장·노선·방향이 검증된 단일 버스 후보 또는 역명·노선·출구가 확인된 실제 출입구에서 가져온다. 역 중심점이나 카카오 BUS polyline 끝점을 실제 탑승 위치라고 간주하지 않는다. 여러 후보를 임의 선택하지 않는다. 검증된 좌표가 없으면 자동 감지를 끄고 수동 종료를 안내한다.

표시하는 목표까지의 거리는 **도착 판정용 직선거리**다. 실제 남은 보행 도로망 거리·전체 ETA로 사용하지 않는다. 지하철의 목표는 출입구이며 승강장까지의 내부 이동시간은 미확인이다.

## Windows / iPhone Safari 수동 확인

1. 로그인 후 경로를 검색하고 선택한다. 이때 보행 기록이 시작되지 않아야 한다.
2. 상세의 목표 이름·출처를 확인한다. 좌표 미확정이면 자동 감지 비활성 안내가 보여야 한다.
3. 안내 시작을 한 번 누른다. GPS 마커와 상태가 갱신되고 기존 기록이 하나만 생성되는지 확인한다.
4. 목표 40m 밖에서는 종료되지 않아야 한다. 40m 안에서 정확도 30m 이내의 새 위치가 연속 3개 수신되면 종료·로컬 저장 확인 문구가 나와야 한다.
5. 기록 목록에서 해당 완료 기록의 원본 GPS와 종료시각을 확인한다. 이동을 이어가도 버스·열차 이동 GPS가 그 기록에 추가되면 안 된다.
6. 다른 측정이 이미 실행 중이면 추가 안내를 시작하지 않아야 한다. 안내 중 목록 복귀·지도 접기는 기존 기록을 유지하며, 다른 경로 선택은 종료 전까지 제한한다.
7. 수동 안내 종료, 경로 좌표 변경, 다른 페이지 이동에서도 시작된 자기 기록만 안전하게 종료하는지 확인한다.
8. 화면 잠금·백그라운드·GPS 오류 뒤에는 도착 판정을 보류해야 한다. 화면 복귀 후 새 GPS를 기다리며 과거 경로를 생성하지 않아야 한다.
9. 기록 시작 후 네트워크를 끊고 종료한다. 로컬 저장과 서버 동기화 대기가 구분되고, 온라인 복귀 후 기존 동기화가 완료되는지 확인한다.
10. 위치 권한 거부·저장 공간 오류에서 거짓 저장 완료가 표시되지 않아야 한다.

## 제한

- Safari의 화면 잠금·백그라운드 GPS 지속 수집은 보장하지 않는다. 도착 반경에 들어왔더라도 새롭고 정확한 관측이 부족하면 수동 종료가 필요하다.
- 실제 승차는 판별하지 않는다. 자동 저장 메시지가 없으면 대중교통에 타기 전에 수동 종료해야 차량 이동이 보행 기록에 섞이는 것을 방지할 수 있다.
- 권한 거부 시에는 기존 G2 오류 정책을 적용한다. 오류 기록을 정상 완료·학습 데이터로 임의 변경하지 않는다.
- IndexedDB 사용 불가·용량 부족 시 모든 GPS 저장을 보장할 수 없다. 성공적으로 저장된 원본과 기존 전송 대기 항목은 삭제하지 않으며 저장 실패를 명시한다.
- 자동화 테스트의 GPS와 서버 확인 상태는 모의 데이터다. 실제 GPS 정확도, 보행, Safari 수신 재개, Supabase 원격 저장은 위 수동 절차로 별도 검증해야 한다.
