# 마인크래프트 서버 웹 관리 패널

웹사이트에서만 서버를 관리하는 Paper 플러그인(**WebPanel**)과 관리 사이트입니다.
인게임 명령어는 하나도 없고, 토큰을 아는 사람(나)만 사이트에서 조작할 수 있습니다.

- 대상 서버: **Paper 26.3** (Java 25)
- `plugin/` : 플러그인 소스 (Gradle)
- `web/` : 관리 사이트 (빌드 과정 없는 순수 HTML/JS → Cloudflare Pages에 그대로 올림)

## 기능

| 화면 | 할 수 있는 것 | 실시간 |
|---|---|---|
| 대시보드 | TPS, 틱 처리 시간, 메모리, 접속자, 월드별 엔티티/청크, 월드 저장, 서버 종료 | 2초마다 갱신 |
| 플레이어 | 접속자(체력/배고픔/위치/핑) + 오프라인 목록, 게임모드, 회복, 레벨, 텔레포트, 메시지, 킬, 추방, 밴/해제, OP, 화이트리스트 | 입장/퇴장 즉시 |
| 인벤토리 · 엔더상자 | 칸 보기, 끌어서 옮기기(Shift = 절반), 휴지통, 아이템 편집(종류·개수·이름·설명·마법부여·내구도), 새 아이템 추가, 전부 비우기 | 인게임 변화가 0.25초 안에 반영 |
| 콘솔 | 서버 로그 실시간 보기, 명령어 실행, 필터, ↑↓ 이전 명령 | 즉시 |
| 서버 설정 | MOTD, 최대 인원, 화이트리스트, 기본 게임모드, 월드별 난이도·시간·날씨·PvP·게임 규칙 | 즉시 적용 + 바뀌면 자동 갱신 |
| server.properties | 파일 직접 편집 | 재시작 후 적용 |

> 인벤토리/엔더상자 수정은 **플레이어가 접속 중일 때만** 됩니다. (오프라인 플레이어 데이터 편집은 아직 없음)

## 구조

```
[관리 사이트 (Cloudflare Pages, https)]
        │  wss:// (WebSocket, 토큰 로그인)
        ▼
[Cloudflare Tunnel]  ← 서버 컴퓨터에서 cloudflared 실행. 포트포워딩 필요 없음
        │  ws://127.0.0.1:8765
        ▼
[WebPanel 플러그인 (Paper 서버 안)]
```

https 사이트에서는 암호화되지 않은 `ws://` 주소에 연결할 수 없어서, **Cloudflare Tunnel로 `wss://` 주소를 만들어 주는 게 필수**입니다.

---

## 1. 플러그인 빌드 / 설치

```bash
cd plugin
./gradlew build
```

(Windows PowerShell 에서는 `.\gradlew.bat build`)
결과물: `plugin/build/libs/WebPanel-1.0.0.jar` → 서버의 `plugins/` 폴더에 넣고 서버를 켭니다.

처음 켜지면 콘솔에 이렇게 **로그인 토큰**이 나옵니다. (`plugins/WebPanel/config.yml` 에도 저장됨)

```
[WebPanel] WebPanel 로그인 토큰이 새로 만들어졌습니다:
[WebPanel] 3f9a....
```

토큰이 유출됐다면 `config.yml` 의 `token: ''` 으로 비우고 서버를 재시작하면 새로 만들어집니다.

## 2. Cloudflare Tunnel 로 wss:// 주소 만들기

### A. 내 도메인이 Cloudflare에 있는 경우 (권장, 주소가 고정됨)

1. Cloudflare 대시보드 > **Zero Trust** > **Networks** > **Tunnels** > **Create a tunnel** > **Cloudflared**
2. 이름 입력 (예: `mc-panel`) → 나오는 설치 명령을 서버 컴퓨터에서 실행 (Windows 서비스로 설치됨)
3. **Public Hostname** 추가
   - Subdomain: `mc-api` / Domain: 내 도메인
   - Service: Type `HTTP`, URL `127.0.0.1:8765`
4. 사이트 로그인 화면의 서버 주소에 `wss://mc-api.내도메인` 입력

### B. 도메인이 없는 경우 (테스트용, 켤 때마다 주소가 바뀜)

```bash
cloudflared tunnel --url http://127.0.0.1:8765
```

출력되는 `https://xxxx.trycloudflare.com` 을 `wss://xxxx.trycloudflare.com` 으로 바꿔서 입력합니다.

## 3. 사이트를 GitHub + Cloudflare Pages 로 배포

1. 이 폴더 전체를 GitHub 저장소에 올립니다.
2. Cloudflare 대시보드 > **Workers & Pages** > **Create** > **Pages** > **Connect to Git** > 저장소 선택
3. 빌드 설정
   - Framework preset: `None`
   - Build command: (비워 둠)
   - Build output directory: `web`
4. **Save and Deploy** → `https://프로젝트명.pages.dev` 주소가 생깁니다.

이후로는 GitHub에 push 할 때마다 자동으로 다시 배포됩니다.

## 4. 보안 설정 (꼭 하세요)

1. **허용 사이트 제한** — `plugins/WebPanel/config.yml`

   ```yaml
   allowed-origins:
     - https://프로젝트명.pages.dev
   ```

   저장 후 서버 재시작. 다른 사이트에서 이 서버에 접속하려는 시도를 막습니다.

2. **토큰은 사이트 코드에 들어가지 않습니다.** 로그인할 때 입력하고, "이 브라우저에 기억하기"를 체크했을 때만 그 브라우저에 저장됩니다. 공용 PC에서는 체크하지 마세요.
3. 같은 IP에서 토큰을 5번 틀리면 15분간 차단됩니다. (`auth:` 항목에서 조정)
4. 더 강하게 막고 싶다면 Cloudflare Zero Trust > **Access** 로 사이트(`pages.dev`)와 터널 주소(`mc-api.내도메인`) 모두에 "내 이메일만 허용" 정책을 걸 수 있습니다.
5. `host: 127.0.0.1` 은 바꾸지 마세요. 터널을 거치지 않은 외부 직접 접속을 막아 줍니다.

## 설정 파일 (`plugins/WebPanel/config.yml`)

| 항목 | 기본값 | 설명 |
|---|---|---|
| `host` / `port` | `127.0.0.1` / `8765` | WebSocket 서버 주소 |
| `token` | 자동 생성 | 로그인 토큰 |
| `allowed-origins` | `'*'` | 접속 허용 사이트 |
| `auth.max-failures` / `auth.block-minutes` | 5 / 15 | 로그인 실패 차단 |
| `sync.inventory-interval-ticks` | 5 | 인벤토리 확인 주기 (20틱 = 1초) |
| `sync.status-interval-ticks` | 40 | 상태/설정/접속자 갱신 주기 |
| `console-buffer-lines` | 500 | 웹 콘솔에 보관할 로그 줄 수 |

## 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| "서버에 연결할 수 없습니다" | 서버가 켜져 있는지, cloudflared 가 실행 중인지, 주소가 `wss://` 로 시작하는지 확인 |
| "https 사이트에서는 ws:// 주소에 연결할 수 없습니다" | 터널 주소(`wss://`)를 쓰세요 |
| "이 사이트 주소가 allowed-origins 에 없습니다" | config.yml 의 `allowed-origins` 에 사이트 주소를 정확히(끝에 `/` 없이) 넣고 재시작 |
| 콘솔에 "포트가 이미 사용 중" | `port` 를 다른 번호로 바꾸고, 터널의 Service URL 도 같이 바꾸기 |
| 아이템 아이콘이 글자로 나옴 | 외부 아이콘 이미지가 없는 아이템입니다. 기능에는 문제없음 |

## 통신 규칙 (참고)

```jsonc
// 요청          {"id": 1, "action": "inv.set", "data": {...}}
// 응답          {"id": 1, "ok": true, "data": {...}}   또는 {"id":1, "ok":false, "error":"..."}
// 실시간 이벤트  {"event": "inv", "data": {...}}
```

action 목록: `auth`, `server.status`, `server.settings`, `server.setting`, `server.gamerule`, `server.properties.get/set`, `server.save`, `server.stop`, `console.history`, `console.command`, `players.list`, `player.action`, `registry.items`, `inv.get`, `inv.subscribe`, `inv.unsubscribe`, `inv.set`, `inv.move`, `inv.clear`, `inv.give`

event 목록: `status`, `settings`, `players`, `players.online`, `console`, `inv`
