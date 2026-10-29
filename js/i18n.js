import { STORAGE_KEYS } from "./config.js";

const DICT = {
  ru: {
    "app.name": "LongCall 98",
    "common.ok": "ОК",
    "common.cancel": "Отмена",
    "common.close": "Закрыть",
    "common.save": "Сохранить",
    "common.copy": "Копировать",
    "common.copied": "Скопировано",
    "common.retry": "Повторить",
    "common.delete": "Удалить",
    "common.you": "вы",
    "common.min": "мин",

    "home.title": "LongCall 98 — Главная",
    "home.title.room": "LongCall 98 — комната {code}",
    "home.tagline": "Лёгкое приложение для звонков прямо в браузере — без установки и регистрации.",
    "home.hint": "Только звук, до 4 человек. Создайте звонок и отправьте друзьям код комнаты.",
    "home.profile": "Учётная запись",
    "home.editProfile": "Изменить…",
    "home.recent": "Недавние звонки",
    "home.join": "Войти",
    "home.refresh": "Обновить",
    "home.remove": "Удалить",
    "home.create": "Создать звонок",
    "home.codeLabel": "Код комнаты:",
    "home.joinCode": "Войти",
    "home.ready": "Готово",
    "home.loadingRecent": "Загрузка истории…",
    "home.signedInAs": "Вы вошли как {nick}",
    "home.status.local": "Локальный аккаунт · только это устройство",
    "home.mic.none": "Микрофон: нет",
    "home.mic.ok": "Микрофон: готов",
    "home.mic.denied": "Микрофон: запрещён",

    "menu.file": "Файл",
    "menu.file.profile": "Профиль…",
    "menu.file.settings": "Настройки звука…",
    "menu.file.signout": "Выйти из аккаунта…",
    "menu.view": "Вид",
    "menu.view.refresh": "Обновить историю",
    "menu.view.sound": "Звуки системы",
    "menu.view.lang": "Язык интерфейса",
    "menu.help": "Справка",
    "menu.help.about": "О программе…",
    "menu.help.readme": "readme.txt",

    "start.title": "Пуск",
    "start.profile": "Профиль…",
    "start.settings": "Настройки…",
    "start.lang": "Язык / Language",
    "start.about": "О программе…",
    "start.signout": "Выйти из аккаунта…",

    "boot.stage1": "Загрузка LongCall 98…",
    "boot.stage2": "Проверка звуковой карты…",
    "boot.stage3": "Восстановление локального профиля…",
    "boot.stage4": "Подключение к сети…",
    "boot.version": "версия {v} · Windows 9x Edition",
    "boot.copyright": "© 1998—{year} LongCall Systems",

    "call.menu": "Звонок",
    "call.title": "Звонок {code}",
    "call.room": "Комната",
    "call.copyLink": "Ссылка",
    "call.linkCopied": "Ссылка на комнату скопирована",
    "call.openApp": "В приложении",
    "call.openAppHint": "Ссылка откроет настольное приложение LongCall 98, если оно установлено. Иначе звонок останется здесь, в браузере.",
    "call.openAppTitle": "Открыть в приложении LongCall 98",
    "call.connecting": "Подключение…",
    "call.mic": "Микрофон",
    "call.mutedToast": "Микрофон выключен",
    "call.unmutedToast": "Микрофон включён",
    "call.participants": "Участники",
    "call.files": "Файлы",
    "call.settings": "Настройки",
    "call.hangup": "Завершить",
    "call.hangupMenu": "Завершить звонок",
    "call.you": "вы",
    "call.waiting": "Ожидание участников",
    "call.waitingHint": "Отправьте друзьям код {code}",
    "call.waitingHintLink": "или ссылку на комнату",
    "call.peer.connecting": "соединение…",
    "call.peer.connected": "на связи",
    "call.peer.failed": "нет связи",
    "call.peer.disconnected": "обрыв…",
    "call.peer.muted": "микрофон выключен",
    "call.peer.left": "покинул комнату",
    "call.joined": "{nick} присоединился",
    "call.left": "{nick} покинул комнату",
    "call.connectedTo": "Соединение установлено: {nick}",
    "call.youAreIn": "Вы в комнате {code}",
    "call.status.connecting": "Связь: установка…",
    "call.status.ready": "Связь: {n} из {max} участников",
    "call.status.solo": "Связь: ожидание участников",
    "call.status.offline": "Связь: нет сети",
    "call.duration": "Длительность",
    "call.ended": "Звонок завершён",
    "call.webHost": "Веб",

    "call.progress.join": "Регистрация в комнате {code}…",
    "call.progress.media": "Запрос доступа к микрофону…",
    "call.progress.peers": "Соединение с участниками: {n} из {total}…",
    "call.progress.done": "Готово",
    "call.progress.reconnect": "Переподключение…",

    "recent.empty.title": "История пуста",
    "recent.empty.text": "Создайте первый звонок — он появится здесь.",
    "recent.live": "в комнате",
    "recent.empty": "комната пуста",
    "recent.gone": "комната закрыта",
    "recent.now": "только что",
    "recent.minAgo": "{n} мин назад",
    "recent.today": "сегодня, {time}",
    "recent.yesterday": "вчера, {time}",
    "recent.members": "{n} из {max}",
    "recent.loadError": "Не удалось загрузить историю",

    "modal.welcome.title": "Знакомство",
    "modal.welcome.text": "Аккаунт создаётся локально: никаких паролей и подтверждений по почте. Профиль хранится только в этом браузере и не переносится на другие устройства.",
    "modal.welcome.nick": "Ваше имя",
    "modal.welcome.nickHint": "Так вас увидят участники звонка. От 2 до 24 символов.",
    "modal.welcome.start": "Начать",
    "modal.welcome.err": "Введите имя от 2 до 24 символов",

    "modal.profile.title": "Профиль",
    "modal.profile.nick": "Имя",
    "modal.profile.uid": "Идентификатор устройства",
    "modal.profile.hint": "Аккаунт локальный: очистка данных браузера удалит его. Пароля нет — восстановить вход нельзя.",
    "modal.profile.saved": "Профиль обновлён",

    "modal.settings.title": "Настройки звука",
    "modal.settings.mic": "Микрофон",
    "modal.settings.micDefault": "Системный по умолчанию",
    "modal.settings.level": "Уровень сигнала",
    "modal.settings.test": "Проверить микрофон",
    "modal.settings.stopTest": "Остановить проверку",
    "modal.settings.sounds": "Системные звуки",
    "modal.settings.lang": "Язык / Language",
    "modal.settings.hint": "Настройки хранятся на этом устройстве. Во время звонка микрофон переключается на лету.",
    "modal.settings.grant": "Разрешите доступ к микрофону в браузере",

    "modal.signout.title": "Выход",
    "modal.signout.text": "Локальный аккаунт будет удалён с этого устройства. История звонков останется в облаке, но вернуться к ней можно будет только с прежним идентификатором.",

    "modal.leave.title": "Завершить звонок?",
    "modal.leave.text": "Соединение с участниками комнаты {code} будет закрыто.",

    "modal.join.title": "Приглашение",
    "modal.join.text": "Вас пригласили в комнату {code}. Войти?",
    "modal.join.app": "Открыть в приложении",
    "err.iceTitle": "Не удалось соединиться",
    "err.iceText": "Прямой канал не установился, а ретранслятор (TURN) недоступен. Обычно это значит, что сеть блокирует UDP или TURN-сервер не отвечает. Попробуйте другую сеть или мобильный интернет.",
    "modal.join.hint": "Если приложение LongCall 98 установлено, ссылка откроет его.",
    "menu.help.report": "Отправить отчёт о проблеме…",
    "diag.sentTitle": "Отчёт отправлен",
    "diag.sentText": "Код отчёта: {id}. По нему можно найти запись в базе.",
    "diag.sent": "отчёт отправлен: {id}",
    "diag.failedTitle": "Отчёт не отправлен",
    "diag.failedText": "Не удалось записать отчёт: {err}",
    "diag.failed": "отчёт не отправлен: {err}",
    "diag.noneTitle": "Нет данных",
    "diag.noneText": "Отчёт можно отправить во время звонка.",


    "modal.notfound.title": "Комната не найдена",
    "modal.notfound.text": "Комнаты {code} сейчас нет: возможно, в ней уже никого. Создать её заново?",
    "modal.notfound.create": "Создать и войти",

    "modal.full.title": "Комната заполнена",
    "modal.full.text": "В комнате {code} уже {max} участника — это предел для приложения.",

    "modal.participants.title": "Участники",
    "modal.participants.count": "{n} из {max}",
    "modal.participants.empty": "Пока только вы",
    "modal.participants.micOn": "микрофон включён",
    "modal.participants.micOff": "микрофон выключен",

    "modal.about.title": "О программе",
    "modal.about.p1": "LongCall 98 — лёгкое веб-приложение для аудиозвонков в оформлении Windows 9x.",
    "modal.about.p2": "Звук идёт напрямую между браузерами по WebRTC (полносвязная сеть). Firebase используется только для сигналинга: обмена служебными сообщениями о соединении.",
    "modal.about.p3": "До 4 участников. Видео не поддерживается. Регистрация локальная, паролей нет.",
    "modal.about.p4": "Сборка {v} · GitHub Pages · {year}",

    "modal.readme.title": "readme.txt",
    "modal.readme.body": "LONGCALL 98 — КАК ЭТО РАБОТАЕТ\n\n1. Введите имя — аккаунт создастся локально.\n2. Нажмите «Создать звонок» или введите код комнаты.\n3. Отправьте друзьям код или ссылку.\n4. Разрешите браузеру доступ к микрофону.\n5. Говорите: до 4 человек в комнате.\n\nЗвук идёт напрямую между участниками,\nFirebase передаёт только служебные сообщения.\n\nСовет: наушники уменьшают эхо.\n\nФайлы в звонке: кнопка «Файлы» на панели.\nФайлы хранятся в Firebase и удаляются,\nкогда комната закрывается.",

    "files.title": "Файлы звонка",
    "files.menu": "Файлы звонка…",
    "files.send": "Отправить файл…",
    "files.download": "Скачать",
    "files.remove": "Удалить",
    "files.removeAsk": "Удалить файл «{name}» у всех в звонке?",
    "files.close": "Закрыть",
    "files.empty": "Пока пусто. Отправьте файл — он появится у всех в звонке.",
    "files.hint": "До {max} на файл, не больше {count} файлов в комнате. Файлы хранятся в Firebase и удаляются, когда комната закрывается.",
    "files.uploading": "Отправка «{name}»…",
    "files.uploadingProgress": "Отправка «{name}» — {p}%",
    "files.sent": "Файл отправлен",
    "files.incoming": "{nick} отправил файл",
    "files.downloaded": "Файл сохранён: {name}",
    "files.removed": "Файл удалён",
    "files.cancel": "Отменить",
    "files.cancelled": "Отправка отменена",
    "files.busy": "Сначала дождитесь конца текущей отправки",
    "files.count": "{n} из {max}",
    "files.log.incoming": "{nick}: файл «{name}»",
    "files.log.sent": "отправлен файл «{name}»",
    "files.log.removed": "файл «{name}» удалён",
    "files.err.watch": "Список файлов недоступен — проверьте правила базы",
    "err.filesDenied": "Не удалось получить список файлов. Проверьте правила Realtime Database.",
    "err.fileEmpty": "Файл пустой — отправлять нечего.",
    "err.fileBusy": "Уже идёт отправка файла. Дождитесь её окончания.",
    "err.fileBig": "Файл больше {max}. Выберите файл поменьше.",
    "err.fileLimit": "В комнате уже {max} файлов. Удалите ненужные и попробуйте снова.",
    "err.fileCancelled": "Отправка отменена.",
    "err.fileBroken": "Файл повреждён или ещё не догрузился. Попробуйте позже.",
    "err.filesRules": "Firebase отклонил файл. Проверьте правила Realtime Database.",
    "err.fileFailed": "Не удалось передать файл. Проверьте интернет и повторите. {msg}",
    "err.title": "Ошибка",
    "err.mic": "Браузер не дал доступ к микрофону. Разрешите его в настройках сайта и попробуйте снова.",
    "err.mic.none": "Микрофон не найден. Подключите устройство записи и повторите.",
    "err.insecure": "Для звонков нужен HTTPS или localhost: браузер блокирует микрофон на незащищённом адресе.",
    "err.unsupported": "Браузер не поддерживает WebRTC. Обновите его или откройте сайт в Chrome, Edge, Firefox или Safari.",
    "err.auth": "Не удалось войти в Firebase. Проверьте, что включён анонимный вход и добавлен авторизованный домен {host}.",
    "err.network": "Нет связи с сервером сигналинга. Проверьте интернет и повторите попытку.",
    "err.full": "В комнате уже {max} участника.",
    "err.rules": "Firebase отклонил запрос. Проверьте правила Realtime Database в консоли проекта.",
    "err.room": "Комната недоступна.",
    "err.generic": "Что-то пошло не так: {msg}",
    "err.code": "Код комнаты — четыре цифры.",
    "err.nick": "Имя должно быть от 2 до 24 символов.",
    "err.callFailed": "Не удалось подключиться к комнате.",

    "toast.joinTitle": "Комната {code}",
    "toast.joinText": "Вы вошли. Отправьте код друзьям.",
    "toast.leftTitle": "Звонок завершён",
    "toast.leftText": "Вы вышли из комнаты {code}.",
    "toast.recentDeleted": "Звонок удалён из истории",
    "toast.copied": "Скопировано в буфер обмена",
    "toast.noRoom": "Такой комнаты сейчас нет — она будет создана заново",
    "toast.profileSaved": "Имя сохранено",
    "toast.soundOn": "Звуки включены",
    "toast.soundOff": "Звуки выключены",
    "toast.langChanged": "Язык интерфейса: Русский",
    "toast.reconnecting": "Связь с сервером потеряна, переподключаемся…",
    "toast.reconnected": "Связь восстановлена",

    "status.tab.home": "LongCall 98",
    "status.tab.call": "Звонок {code}",
    "status.lang": "RU",
  },

  en: {
    "app.name": "LongCall 98",
    "common.ok": "OK",
    "common.cancel": "Cancel",
    "common.close": "Close",
    "common.save": "Save",
    "common.copy": "Copy",
    "common.copied": "Copied",
    "common.retry": "Retry",
    "common.delete": "Delete",
    "common.you": "you",
    "common.min": "min",

    "home.title": "LongCall 98 — Home",
    "home.title.room": "LongCall 98 — room {code}",
    "home.tagline": "A lightweight calling app right in your browser — no install, no sign-up.",
    "home.hint": "Audio only, up to 4 people. Start a call and share the room code.",
    "home.profile": "Local account",
    "home.editProfile": "Change…",
    "home.recent": "Recent calls",
    "home.join": "Join",
    "home.refresh": "Refresh",
    "home.remove": "Delete",
    "home.create": "Start a call",
    "home.codeLabel": "Room code:",
    "home.joinCode": "Join",
    "home.ready": "Ready",
    "home.loadingRecent": "Loading history…",
    "home.signedInAs": "Signed in as {nick}",
    "home.status.local": "Local account · this device only",
    "home.mic.none": "Mic: none",
    "home.mic.ok": "Mic: ready",
    "home.mic.denied": "Mic: blocked",

    "menu.file": "File",
    "menu.file.profile": "Profile…",
    "menu.file.settings": "Sound settings…",
    "menu.file.signout": "Sign out…",
    "menu.view": "View",
    "menu.view.refresh": "Refresh history",
    "menu.view.sound": "System sounds",
    "menu.view.lang": "Interface language",
    "menu.help": "Help",
    "menu.help.about": "About…",
    "menu.help.readme": "readme.txt",

    "start.title": "Start",
    "start.profile": "Profile…",
    "start.settings": "Settings…",
    "start.lang": "Язык / Language",
    "start.about": "About…",
    "start.signout": "Sign out…",

    "boot.stage1": "Starting LongCall 98…",
    "boot.stage2": "Checking sound card…",
    "boot.stage3": "Restoring local profile…",
    "boot.stage4": "Connecting to the network…",
    "boot.version": "version {v} · Windows 9x Edition",
    "boot.copyright": "© 1998—{year} LongCall Systems",

    "call.menu": "Call",
    "call.title": "Call {code}",
    "call.room": "Room",
    "call.copyLink": "Link",
    "call.linkCopied": "Room link copied",
    "call.openApp": "In the app",
    "call.openAppHint": "The link will open the LongCall 98 desktop app if it is installed. Otherwise the call stays here, in the browser.",
    "call.openAppTitle": "Open in the LongCall 98 app",
    "call.connecting": "Connecting…",
    "call.mic": "Microphone",
    "call.mutedToast": "Microphone off",
    "call.unmutedToast": "Microphone on",
    "call.participants": "People",
    "call.files": "Files",
    "call.settings": "Settings",
    "call.hangup": "Hang up",
    "call.hangupMenu": "End call",
    "call.you": "you",
    "call.waiting": "Waiting for people",
    "call.waitingHint": "Share code {code} with your friends",
    "call.waitingHintLink": "or send the room link",
    "call.peer.connecting": "connecting…",
    "call.peer.connected": "connected",
    "call.peer.failed": "no connection",
    "call.peer.disconnected": "dropped…",
    "call.peer.muted": "mic off",
    "call.peer.left": "left the room",
    "call.joined": "{nick} joined",
    "call.left": "{nick} left the room",
    "call.connectedTo": "Connected: {nick}",
    "call.youAreIn": "You are in room {code}",
    "call.status.connecting": "Link: connecting…",
    "call.status.ready": "Link: {n} of {max} people",
    "call.status.solo": "Link: waiting for people",
    "call.status.offline": "Link: offline",
    "call.duration": "Duration",
    "call.ended": "Call ended",
    "call.webHost": "Web",

    "call.progress.join": "Registering in room {code}…",
    "call.progress.media": "Requesting microphone access…",
    "call.progress.peers": "Connecting to people: {n} of {total}…",
    "call.progress.done": "Done",
    "call.progress.reconnect": "Reconnecting…",

    "recent.empty.title": "No calls yet",
    "recent.empty.text": "Start your first call — it will show up here.",
    "recent.live": "inside",
    "recent.empty": "room is empty",
    "recent.gone": "room is closed",
    "recent.now": "just now",
    "recent.minAgo": "{n} min ago",
    "recent.today": "today, {time}",
    "recent.yesterday": "yesterday, {time}",
    "recent.members": "{n} of {max}",
    "recent.loadError": "Could not load history",

    "modal.welcome.title": "Welcome",
    "modal.welcome.text": "Your account is created locally: no passwords, no email confirmations. The profile lives in this browser only and does not move to other devices.",
    "modal.welcome.nick": "Your name",
    "modal.welcome.nickHint": "This is what other people will see. 2 to 24 characters.",
    "modal.welcome.start": "Get started",
    "modal.welcome.err": "Enter a name of 2 to 24 characters",

    "modal.profile.title": "Profile",
    "modal.profile.nick": "Name",
    "modal.profile.uid": "Device identifier",
    "modal.profile.hint": "The account is local: clearing browser data deletes it. There is no password, so access cannot be recovered.",
    "modal.profile.saved": "Profile updated",

    "modal.settings.title": "Sound settings",
    "modal.settings.mic": "Microphone",
    "modal.settings.micDefault": "System default",
    "modal.settings.level": "Input level",
    "modal.settings.test": "Test microphone",
    "modal.settings.stopTest": "Stop test",
    "modal.settings.sounds": "System sounds",
    "modal.settings.lang": "Language / Язык",
    "modal.settings.hint": "Settings are stored on this device. The microphone is switched live during a call.",
    "modal.settings.grant": "Allow microphone access in your browser",

    "modal.signout.title": "Sign out",
    "modal.signout.text": "The local account will be removed from this device. Call history stays in the cloud but can only be reached with the same identifier.",

    "modal.leave.title": "End the call?",
    "modal.leave.text": "The connection with people in room {code} will be closed.",

    "modal.join.title": "Invitation",
    "modal.join.text": "You have been invited to room {code}. Join now?",
    "modal.join.app": "Open in the app",
    "err.iceTitle": "Could not connect",
    "err.iceText": "The direct channel failed and the TURN relay is unreachable. This usually means the network blocks UDP or the TURN server does not respond. Try another network or mobile data.",
    "modal.join.hint": "If LongCall 98 is installed, the link will open it.",
    "menu.help.report": "Send a problem report…",
    "diag.sentTitle": "Report sent",
    "diag.sentText": "Report code: {id}. Use it to find the record in the database.",
    "diag.sent": "report sent: {id}",
    "diag.failedTitle": "Report not sent",
    "diag.failedText": "Could not save the report: {err}",
    "diag.failed": "report not sent: {err}",
    "diag.noneTitle": "No data",
    "diag.noneText": "A report can be sent during a call.",


    "modal.notfound.title": "Room not found",
    "modal.notfound.text": "Room {code} does not exist right now — maybe it is empty. Create it again?",
    "modal.notfound.create": "Create and join",

    "modal.full.title": "Room is full",
    "modal.full.text": "Room {code} already has {max} people — that is the limit.",

    "modal.participants.title": "People",
    "modal.participants.count": "{n} of {max}",
    "modal.participants.empty": "Only you so far",
    "modal.participants.micOn": "mic on",
    "modal.participants.micOff": "mic off",

    "modal.about.title": "About",
    "modal.about.p1": "LongCall 98 is a lightweight audio calling web app dressed as Windows 9x.",
    "modal.about.p2": "Sound travels directly between browsers over WebRTC (full mesh). Firebase is used for signalling only: exchanging connection metadata.",
    "modal.about.p3": "Up to 4 people. No video. Local sign-up, no passwords.",
    "modal.about.p4": "Build {v} · GitHub Pages · {year}",

    "modal.readme.title": "readme.txt",
    "modal.readme.body": "LONGCALL 98 — HOW IT WORKS\n\n1. Enter a name — the account is created locally.\n2. Press “Start a call” or type a room code.\n3. Send the code or the link to your friends.\n4. Allow microphone access in the browser.\n5. Talk: up to 4 people per room.\n\nSound goes directly between people;\nFirebase carries signalling messages only.\n\nTip: headphones reduce echo.\n\nFiles in a call: the “Files” button on the panel.\nFiles live in Firebase and are deleted when\nthe room closes.",

    "files.title": "Call files",
    "files.menu": "Call files…",
    "files.send": "Send a file…",
    "files.download": "Save",
    "files.remove": "Delete",
    "files.removeAsk": "Delete “{name}” for everyone in the call?",
    "files.close": "Close",
    "files.empty": "Nothing yet. Send a file and everyone in the call gets it.",
    "files.hint": "Up to {max} per file, at most {count} files per room. Files live in Firebase and are deleted when the room closes.",
    "files.uploading": "Sending “{name}”…",
    "files.uploadingProgress": "Sending “{name}” — {p}%",
    "files.sent": "File sent",
    "files.incoming": "{nick} sent a file",
    "files.downloaded": "Saved: {name}",
    "files.removed": "File deleted",
    "files.cancel": "Cancel",
    "files.cancelled": "Sending cancelled",
    "files.busy": "Wait for the current upload to finish",
    "files.count": "{n} of {max}",
    "files.log.incoming": "{nick}: file “{name}”",
    "files.log.sent": "sent file “{name}”",
    "files.log.removed": "file “{name}” deleted",
    "files.err.watch": "The file list is unavailable — check the database rules",
    "err.filesDenied": "Could not load the file list. Check the Realtime Database rules.",
    "err.fileEmpty": "The file is empty — nothing to send.",
    "err.fileBusy": "A file is already being sent. Wait for it to finish.",
    "err.fileBig": "The file is larger than {max}. Pick a smaller one.",
    "err.fileLimit": "The room already has {max} files. Delete some and try again.",
    "err.fileCancelled": "Sending cancelled.",
    "err.fileBroken": "The file is damaged or not uploaded yet. Try again later.",
    "err.filesRules": "Firebase rejected the file. Check the Realtime Database rules.",
    "err.fileFailed": "Could not transfer the file. Check the network and retry. {msg}",
    "err.title": "Error",
    "err.mic": "The browser blocked microphone access. Allow it in the site settings and try again.",
    "err.mic.none": "No microphone found. Connect a recording device and retry.",
    "err.insecure": "Calls need HTTPS or localhost: browsers block the microphone on insecure addresses.",
    "err.unsupported": "This browser does not support WebRTC. Update it or use Chrome, Edge, Firefox or Safari.",
    "err.auth": "Firebase sign-in failed. Check that anonymous auth is enabled and {host} is an authorized domain.",
    "err.network": "No connection to the signalling server. Check the network and retry.",
    "err.full": "Room already has {max} people.",
    "err.rules": "Firebase rejected the request. Check the Realtime Database rules in the project console.",
    "err.room": "The room is unavailable.",
    "err.generic": "Something went wrong: {msg}",
    "err.code": "A room code is four digits.",
    "err.nick": "The name must be 2 to 24 characters long.",
    "err.callFailed": "Could not join the room.",

    "toast.joinTitle": "Room {code}",
    "toast.joinText": "You are in. Share the code with your friends.",
    "toast.leftTitle": "Call ended",
    "toast.leftText": "You left room {code}.",
    "toast.recentDeleted": "Removed from history",
    "toast.copied": "Copied to clipboard",
    "toast.noRoom": "That room is gone — it will be created again",
    "toast.profileSaved": "Name saved",
    "toast.soundOn": "Sounds on",
    "toast.soundOff": "Sounds off",
    "toast.langChanged": "Interface language: English",
    "toast.reconnecting": "Lost connection to the server, reconnecting…",
    "toast.reconnected": "Connection restored",

    "status.tab.home": "LongCall 98",
    "status.tab.call": "Call {code}",
    "status.lang": "EN",
  },
};

let lang = "ru";
const listeners = new Set();

export function getLang() {
  return lang;
}

export function setLang(next) {
  lang = DICT[next] ? next : "ru";
  try {
    localStorage.setItem(STORAGE_KEYS.lang, lang);
  } catch {}
  document.documentElement.lang = lang;
  applyI18n();
  listeners.forEach((fn) => fn(lang));
}

export function initLang() {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEYS.lang);
  } catch {}
  if (stored && DICT[stored]) {
    lang = stored;
  } else {
    const nav = (navigator.language || "ru").toLowerCase();
    lang = nav.startsWith("ru") ? "ru" : "en";
  }
  document.documentElement.lang = lang;
}

export function toggleLang() {
  setLang(lang === "ru" ? "en" : "ru");
  return lang;
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key, params) {
  const table = DICT[lang] || DICT.ru;
  let str = table[key];
  if (str == null) str = (DICT.ru[key] ?? key);
  if (params) {
    str = str.replace(/\{(\w+)\}/g, (m, name) =>
      params[name] != null ? String(params[name]) : m
    );
  }
  return str;
}

export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll("[data-i18n-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nLabel));
  });
}

export function formatDate(ts, now = Date.now()) {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const d = new Date(ts);
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const diff = now - ts;
  if (diff < 60_000) return t("recent.now");
  if (diff < 3_600_000) return t("recent.minAgo", { n: Math.floor(diff / 60_000) });

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (ts >= startOfToday.getTime()) return t("recent.today", { time });
  if (ts >= startOfToday.getTime() - 86_400_000) return t("recent.yesterday", { time });
  return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
}
