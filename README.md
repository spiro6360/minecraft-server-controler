# 마인크래프트 서버 웹 관리 패널

웹사이트에서만 서버를 관리하는 Paper 플러그인(**WebPanel**)과 관리 사이트입니다.
인게임 명령어는 하나도 없고, 토큰을 아는 사람(나)만 사이트에서 조작할 수 있습니다.

- 대상 서버: **Paper 26.3** (Java 25), 호스팅 업체 서버에서도 동작 (포트 개방 불필요)
- `web/` : 관리 사이트 (빌드 과정 없는 순수 HTML/JS → Cloudflare Pages)
- `plugin/` : 플러그인 소스 — **이 저장소에는 올리지 않고 개인 컴퓨터에만 보관**
- `relay/` : 중계 서버(Cloudflare Worker) 소스 — **개인 컴퓨터에만 보관**

## 구조

```
[관리 사이트 (Pages)] ──wss──▶ [중계 서버 (Cloudflare Worker)] ◀──wss── [플러그인 (마인크래프트 서버)]
       사이트가 접속                   둘이 여기서 만남                 플러그인이 밖으로 접속
```

플러그인이 중계 서버에 **밖으로** 접속하기 때문에, 호스팅 서버에서 포트를 열거나 프로그램을 설치할 필요가 없습니다.

## 기능

| 화면 | 할 수 있는 것 | 실시간 |
|---|---|---|
| 대시보드 | TPS, 틱 처리 시간, 메모리, 접속자, 월드별 엔티티/청크, 월드 저장, 서버 종료 | 2초마다 갱신 |
| 플레이어 | 접속자(체력/배고픔/위치/핑) + 오프라인 목록, 게임모드, 회복, 레벨, 텔레포트, 메시지, 킬, 추방, 밴/해제, OP, 화이트리스트 | 입장/퇴장 즉시 |
| 인벤토리 · 엔더상자 | 칸 보기, 끌어서 옮기기(Shift = 절반), 휴지통, 아이템 편집(종류·개수·이름·설명·마법부여·내구도), 새 아이템 추가, 전부 비우기 | 인게임 변화가 0.25초 안에 반영 |
| 콘솔 | 서버 로그 실시간 보기, 명령어 실행, 필터, ↑↓ 이전 명령 | 즉시 |
| 서버 설정 | MOTD, 최대 인원, 화이트리스트, 기본 게임모드, 월드별 난이도·시간·날씨·PvP·게임 규칙 | 즉시 적용 + 바뀌면 자동 갱신 |
| server.properties | 파일 직접 편집 | 재시작 후 적용 |

> 인벤토리/엔더상자 수정은 **플레이어가 접속 중일 때만** 됩니다.

## 설치

### 1. 중계 서버 (한 번만)

```bash
cd relay
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put PLUGIN_SECRET
```

- `wrangler.toml` 의 `ALLOWED_ORIGINS` 에 관리 사이트 주소를 넣어 두면 다른 사이트에서의 접속이 막힙니다.
- `PLUGIN_SECRET` 은 플러그인 config.yml 의 `relay-secret` 과 같아야 합니다.

### 2. 플러그인

1. `plugin/build/libs/WebPanel-x.x.x.jar` 를 서버의 `plugins/` 폴더에 넣고 서버를 켭니다. (옛 버전 jar 는 지우기)
2. `plugins/WebPanel/config.yml` 을 엽니다.
   ```yaml
   relay-url: 'https://mc-relay.내계정.workers.dev'
   relay-secret: '중계 서버에 등록한 PLUGIN_SECRET'
   ```
3. 서버를 재시작합니다. 콘솔에 `중계 서버에 연결되었습니다` 가 나오면 성공.
4. 콘솔에 나온 **로그인 토큰**(config.yml 의 `token`)을 복사해 둡니다.

### 3. 관리 사이트 (Cloudflare Pages)

Workers & Pages > Create > Pages > Connect to Git > 이 저장소
- Framework preset `None`, Build command 비움, Build output directory `web`

사이트에서 **중계 서버 주소**(`https://mc-relay.내계정.workers.dev`)와 **로그인 토큰**을 입력하고 연결합니다.

## 보안

- **열쇠 두 개**: 플러그인 ↔ 중계는 `relay-secret`, 사이트 ↔ 플러그인은 로그인 토큰. 토큰은 플러그인이 직접 확인하므로 중계 서버는 모릅니다.
- 같은 IP 에서 토큰을 5번 틀리면 15분간 차단됩니다. (config.yml `auth:`)
- 토큰은 사이트 코드에 없고, "이 브라우저에 기억하기"를 체크했을 때만 브라우저에 저장됩니다.
- 토큰이나 비밀키가 유출되면: 토큰은 config.yml 에서 지우고 재시작(자동 재생성), 비밀키는 `wrangler secret put PLUGIN_SECRET` 로 바꾸고 config.yml 도 같이 수정.

## 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| "마인크래프트 서버가 중계 서버에 연결되어 있지 않습니다" | 서버가 꺼져 있거나 config.yml 의 relay-url / relay-secret 이 비었거나 틀림. 서버 콘솔의 WebPanel 로그 확인 |
| 콘솔에 "중계 비밀키(relay-secret)가 틀렸습니다" | config.yml 의 relay-secret 을 중계 서버의 PLUGIN_SECRET 과 똑같이 |
| 콘솔에 "중계 서버 접속 실패" 가 계속 반복 | 호스팅 업체가 바깥 접속을 막았을 수 있음 → 업체에 문의 |
| "이 사이트 주소가 중계 서버의 ALLOWED_ORIGINS 에 없습니다" | relay/wrangler.toml 의 ALLOWED_ORIGINS 수정 후 다시 deploy |
| "토큰이 올바르지 않습니다" | config.yml 의 token 값을 그대로 복사 |

## 통신 규칙 (참고)

```jsonc
// 사이트 ↔ 플러그인 (중계 서버는 그대로 전달)
// 요청          {"id": 1, "action": "inv.set", "data": {...}}
// 응답          {"id": 1, "ok": true, "data": {...}}   또는 {"id":1, "ok":false, "error":"..."}
// 실시간 이벤트  {"event": "inv", "data": {...}}
```

action 목록: `auth`, `server.status`, `server.settings`, `server.setting`, `server.gamerule`, `server.properties.get/set`, `server.save`, `server.stop`, `console.history`, `console.command`, `players.list`, `player.action`, `registry.items`, `inv.get`, `inv.subscribe`, `inv.unsubscribe`, `inv.set`, `inv.move`, `inv.clear`, `inv.give`

event 목록: `status`, `settings`, `players`, `players.online`, `console`, `inv`
