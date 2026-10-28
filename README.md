# LongCall 98

Лёгкое веб-приложение для **аудиозвонков** в оформлении Windows 9x: рабочий стол, окна с
тильдой, панель задач, «Пуск» и синий прогресс-бар с бегущими «шашечками».

Только звук, до **4 человек** в комнате, без установки и без паролей.
Хостинг — GitHub Pages (статика), сигналинг — Firebase Realtime Database, звук — WebRTC.

```
https://123asxcqasdc.github.io/longcall/
```

## Что внутри

| Возможность | Как сделано |
| --- | --- |
| Локальный аккаунт | Ник хранится в `localStorage`, идентификатор — в cookie `lc_uid` и в Firebase-анониме. Пароля нет, восстановления нет |
| Главное окно | Описание приложения, профиль, кнопка «Создать звонок», вход по коду, история звонков |
| Недавние звонки | `users/{uid}/recent` в Realtime Database: доступны с любого устройства, где выполнен вход |
| Групповой звонок | WebRTC full mesh (каждый с каждым), до 4 участников |
| Индикатор речи | `AnalyserNode` + RMS по локальному и каждому удалённому потоку |
| Прогресс-бар Win9x | Загрузка приложения, вход в комнату, смена микрофона, загрузка истории |
| Языки | Русский и английский, переключатель в меню и в настройках |
| Звуки | Синтезируются через Web Audio, внешних файлов нет |

## Настройка Firebase (обязательно, один раз)

Приложение использует ваш проект `longcall`. Без трёх шагов ниже звонки не заработают.

1. **Анонимный вход.**
   Firebase Console → Authentication → Sign-in method → включить **Anonymous**.

2. **Авторизованные домены.**
   Authentication → Settings → Authorized domains → добавить `123asxcqasdc.github.io`
   (и `localhost`, если проверяете локально).

3. **Правила базы данных.**
   Realtime Database → Rules → вставить содержимое [`database.rules.json`](database.rules.json)
   (или нажать «Правила базы данных…» в меню «Справка» внутри приложения и скопировать JSON оттуда).

   ```
   firebase deploy --only database    # альтернатива, если установлен firebase-tools
   ```

Правила закрывают базу от анонимного интернета: читать и писать комнаты может только
авторизованный Firebase-пользователь, а свой профиль и историю — только их владелец.

## Локальный запуск

```bash
npm install            # только для пересборки Firebase SDK
npm run serve          # python3 -m http.server 8080
# http://localhost:8080
```

Микрофон браузеры разрешают только на `https://` или `localhost` — по IP в локальной
сети звонки не запустятся.

## Сборка Firebase SDK

SDK не тянется с внешнего CDN: он собран заранее в `vendor/firebase.js` (esbuild, ESM,
~250 КБ). Чтобы обновить версию:

```bash
npm run build:vendor
```

`tools/firebase-entry.js` перечисляет используемые функции, поэтому в бандл попадает
только нужное (auth + realtime database).

## Как устроен звонок

```
комната rooms/{code}
├── meta                 {createdAt, createdBy, maxParticipants, audioOnly}
├── participants/{uid}   {nick, joinedAt, muted}   ← presence через onDisconnect
└── signals/{to}/{msgId} {from, type: description|ice|bye, sdp|candidate, at}
```

* Топология — **full mesh**: каждый участник держит `RTCPeerConnection` с каждым.
  Для 4 человек это 3 потока на клиент, ~40 кбит/с каждый.
* Переговоры — по схеме *perfect negotiation*: участник с меньшим `uid` инициатор,
  с большим — «вежливый», поэтому одновременные offer'ы разводятся без конфликтов.
* ICE-кандидаты буферизуются до получения remote description; при `failed`/долгом
  `disconnected` выполняется `restartIce()` с нарастающей паузой.
* Последний ушедший участник удаляет комнату — база не копит мусор.
* Видео не запрашивается и не принимается: только `audio`.

### Ограничения, о которых честно

* **4 участника** — предел mesh-схемы. Для 10+ нужен SFU-сервер (не влезает в «Pages + Firebase»).
* **TURN не настроен.** В сетях с симметричным NAT (часть мобильных операторов,
  корпоративные сети) соединение может не установиться. Чтобы включить TURN,
  добавьте сервер в `ICE_SERVERS` в [`js/config.js`](js/config.js) —
  например, бесплатный тариф metered.ca или Cloudflare Calls.
* **Аккаунт локальный.** Очистка данных браузера удаляет профиль и историю.
  Восстановления по почте нет — это осознанный выбор в пользу входа «в один клик».
* **Правила БД** разрешают авторизованным пользователям читать любую комнату по коду:
  код комнаты работает как приглашение (4 цифры = 9000 вариантов, перебор возможен).
  Для приватных звонков используйте более длинные коды (см. `APP.roomCodeLength`).
* Firebase API-ключ в `js/config.js` публичен по дизайну. Рекомендуется ограничить его
  по HTTP-referrer в Google Cloud Console.

## Структура

```
index.html              каркас «рабочего стола» и окон
css/win98.css           тема Win9x: рамки, кнопки, меню, прогресс-бар
css/app.css             раскладка, звонок, taskbar, адаптив
js/main.js              онбординг, главное окно, история, диалоги, окна
js/call.js              WebRTC-сессия и сигналинг
js/callui.js            плитки участников, уровни, журнал, таймер
js/audio.js             микрофон, удалённые потоки, метры, синтез звуков
js/firebase.js          инициализация SDK, auth, история, комнаты
js/ui.js                модалки, тосты, менеджер окон, меню
js/i18n.js              словари RU/EN
js/store.js             localStorage, cookie, утилиты
js/config.js            конфиг Firebase, лимиты, ICE
vendor/firebase.js      собранный Firebase SDK (auth + database)
tools/firebase-entry.js точка входа для сборки SDK
```

## Деплой

Workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) собирает статику
(без `.git`, `node_modules`, `tools`) и публикует её через `actions/deploy-pages`.

Pages включается один раз: Settings → Pages → Source → **GitHub Actions**.
После пуша в `main` сайт обновляется автоматически.

## Совместимость

Chrome/Edge 90+, Firefox 90+, Safari 15.4+ (iOS 15.4+). Нужны `getUserMedia`,
`RTCPeerConnection` и `AudioContext`. На мобильных окна разворачиваются на весь экран.

## Лицензия

Код приложения — см. [LICENSE](LICENSE).
Шрифты MS Sans Serif — из проекта [98.css](https://github.com/jdan/98.css) (MIT).
