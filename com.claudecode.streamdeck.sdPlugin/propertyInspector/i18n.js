// UI strings for the Property Inspector. English is the default; Russian is used when
// Stream Dock runs in Russian. Elements opt in with data-i18n / data-i18n-title /
// data-i18n-placeholder / data-i18n-html attributes holding a key from this table.
const STRINGS = {
  en: {
    chat: 'Chat',
    loading: '— loading… —',
    renameHint: 'Rename a chat with <b>/rename</b> inside it.',
    folder: 'Folder',
    folderPlaceholder: 'empty — home folder',
    browse: 'Choose folder',
    mode: 'Mode',
    modeResume: 'Pinned chat',
    modeContinue: 'Latest chat of the project',
    modePick: 'Pick a chat on launch',
    modeNew: 'New chat',
    session: 'Session',
    reload: 'Refresh list',
    label: 'Title',
    labelPlaceholder: 'folder name',
    terminal: 'Terminal',
    cmd: 'Console (cmd)',
    searching: 'searching…',
    notFound: 'none found',
    shellMissing: 'not found: {0}',
    rescan: 'Find PowerShell on this PC again',
    open: 'Open in',
    newTab: 'New tab',
    newWindow: 'New window',
    args: 'Arguments',
    launchNow: 'Launch now',
    latestChat: '— latest chat —',
    noChats: '— no chats found —',
    pickChat: '— pick a chat by name —',
    lastPrompt: 'Last prompt: {0}',
    noSelection: 'With nothing selected the key continues the latest chat of the project.',
  },
  ru: {
    chat: 'Чат',
    loading: '— загрузка… —',
    renameHint: 'Название меняется командой <b>/rename</b> в самом чате.',
    folder: 'Папка',
    folderPlaceholder: 'пусто — домашняя папка',
    browse: 'Выбрать папку',
    mode: 'Режим',
    modeResume: 'Закреплённый чат',
    modeContinue: 'Последний чат проекта',
    modePick: 'Выбрать чат при запуске',
    modeNew: 'Новый чат',
    session: 'Сессия',
    reload: 'Обновить список',
    label: 'Подпись',
    labelPlaceholder: 'по имени папки',
    terminal: 'Терминал',
    cmd: 'Консоль (cmd)',
    searching: 'поиск…',
    notFound: 'не найдено',
    shellMissing: 'не найден: {0}',
    rescan: 'Заново найти PowerShell на компьютере',
    open: 'Открывать',
    newTab: 'Новой вкладкой',
    newWindow: 'Новым окном',
    args: 'Аргументы',
    launchNow: 'Запустить сейчас',
    latestChat: '— последний чат —',
    noChats: '— чатов не найдено —',
    pickChat: '— выберите чат по названию —',
    lastPrompt: 'Последний запрос: {0}',
    noSelection: 'Без выбора кнопка продолжит последний чат проекта.',
  },
};

let lang = 'en';

function setLanguage(code) {
  lang = String(code || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
}

function t(key, ...args) {
  const s = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\d+)\}/g, (_, i) => args[i] ?? '');
}
