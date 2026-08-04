// worlds.js — конфигурация 15 миров карты.
// В MVP-срезе доступен только dunes; остальные — заглушки.

export const WORLDS = [
  { id: 'port',     icon: '🏙️', title: 'Порт Забытых Слов',  subtitle: 'print — сказать наружу',              locked: true,  levels: 10 },
  { id: 'names',    icon: '📦', title: 'Хранилище Имён',      subtitle: 'переменные',                          locked: true,  levels: 10 },
  { id: 'dunes',    icon: '🏜️', title: 'Дюны Возврата',       subtitle: 'циклы for, range',                    locked: false, levels: 10, mvp: true },
  { id: 'maze',     icon: '🌀', title: 'Лабиринт Условий',    subtitle: 'if / else',                           locked: true,  levels: 10 },
  { id: 'library',  icon: '📚', title: 'Библиотека Строк',    subtitle: 'работа со строками',                  locked: true,  levels: 10 },
  { id: 'forge',    icon: '⚒️', title: 'Кузница Функций',     subtitle: 'def — свои команды',                  locked: true,  levels: 10 },
  { id: 'market',   icon: '🛒', title: 'Ярмарка Списков',     subtitle: 'list — коллекции',                    locked: true,  levels: 10 },
  { id: 'archive',  icon: '🗄️', title: 'Архив Словарей',      subtitle: 'dict — ключ и значение',              locked: true,  levels: 10 },
  { id: 'tower',    icon: '🗼', title: 'Башня Вложений',      subtitle: 'вложенные циклы',                     locked: true,  levels: 10 },
  { id: 'workshop', icon: '🛠️', title: 'Мастерская Модулей',  subtitle: 'import',                              locked: true,  levels: 10 },
  { id: 'garden',   icon: '🌱', title: 'Сад Рекурсии',        subtitle: 'функция вызывает себя',               locked: true,  levels: 10 },
  { id: 'ocean',    icon: '🌊', title: 'Океан Файлов',        subtitle: 'чтение и запись',                     locked: true,  levels: 10 },
  { id: 'lab',      icon: '⚗️', title: 'Лаборатория Классов', subtitle: 'ООП',                                 locked: true,  levels: 10 },
  { id: 'cave',     icon: '🕳️', title: 'Пещера Ошибок',        subtitle: 'try / except',                        locked: true,  levels: 10 },
  { id: 'peak',     icon: '⛰️', title: 'Пик ЕГЭ',              subtitle: 'финальные задачи',                    locked: true,  levels: 10 },
];
