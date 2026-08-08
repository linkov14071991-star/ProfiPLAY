"""
Пересборка quiz-банка под новые требования:
 1. Тема «programming» удаляется: её вопросы вливаются в «informatika» (только
    средний и сложный уровни — простые не допускаются).
 2. ВСЕ вопросы (старые и сгенерированные) перераспределяются по уровням по
    определениям: easy — школа до 9 класса; medium — старшая школа/ЕГЭ;
    hard — ВУЗ/олимпиады/профи.
Остаются 3 темы: informatika, mathematics, physics (по ~340 на уровень).
Запуск: python rebuild_bank.py
"""
import json
import random
from pathlib import Path

random.seed(7)
HERE = Path(__file__).parent
QFILE = HERE / "questions.json"
CAP = 340

# --- сигналы уровня (по ключевым словам, нижний регистр) ---
HARD = [
    "o(n", "o(1", "o(log", "big-o", "big-ω", "сложност", "асимптот", "олимпиад",
    "async", "await", " gil", "mutex", "корутин", "декоратор", "метакласс", "дескриптор",
    "рекурс", "backtrack", " dag", "суффиксн", "two pointers", " куча ", "acid", "полиморф",
    "наследов", "генератор", "lambda", "лямбд", "хеш-табл", "динамическ программ",
    "виртуальн машин", "docker", "kubernetes", "nosql", "транзакц", " ast", "namedtuple",
    "property", "jit", "rsa", "паттерн", "нейросет", "ассемблер", "битов", "многопоточ",
    "производн", "интеграл", "первообразн", " предел", "матриц", "определитель", "детерминант",
    "комплексн", "мнимая", "факториал", "сочетан", "перестанов", "c(", "теорема виет",
    "дискриминант", "золот сечен", "определит",
    "фотон", "квант", "термоядер", "эдс", "индуктивн", "тесла", "генри", "импульс",
    "кинетич", "архимед", "термодинам", "относительност", "чёрн дыр", "интерференц",
    "дифракц", "поляризац", "резонанс", "сверхпровод", "изотоп", "радиоактивн", "джоуль на",
]
EASY = [
    "клавиатур", "мышь", "монитор", "принтер", "флешк", "браузер", "рабочий стол",
    "смайлик", "наушник", "зарядк", "wi-fi", "что показывает", "что делает кнопка",
    "двойн клик", "ярлык", "закрыть окно", "развернуть", "проектор", "сканер", "модем",
    "что такое сайт", "что такое интернет", "что такое файл", "что такое папк",
    "что такое ссылк", "что такое пароль", "что такое логин", "что такое браузер",
    "поисков строк", "калькулятор",
    "площадь прямоугольник", "периметр", "продолжи ряд", "сколько граммов",
    "сколько метров в", "половина от", "среднее арифметическое",
    "сколько будет",  # простая арифметика
    "в чём измеряется единиц", "какой путь", "скорость (м/с)", "сколько времени в пути",
    "сила тяжести тела", "продолжи",
]


def level_of(text, origin, orig_level):
    """Мягкая коррекция: явное сложное → hard, явное простое → easy,
    иначе оставляем исходный уровень (не ломаем сбалансированные банки)."""
    t = " " + text.lower() + " "
    lv = orig_level
    if any(kw in t for kw in HARD):
        lv = "hard"
    elif any(kw in t for kw in EASY):
        lv = "easy"
    # программирование не может быть «простым» — минимум средний
    if origin == "prog" and lv == "easy":
        lv = "medium"
    return lv


def main():
    data = json.loads(QFILE.read_text(encoding="utf-8"))

    # собираем пулы с пометкой происхождения
    themes_src = {
        "informatika": [("informatika", "inf"), ("programming", "prog")],
        "mathematics": [("mathematics", "math")],
        "physics": [("physics", "phys")],
    }
    result = {}
    report = {}
    for theme, sources in themes_src.items():
        buckets = {"easy": [], "medium": [], "hard": []}
        seen = set()
        for src_key, origin in sources:
            for lv in ("easy", "medium", "hard"):
                for it in data.get(src_key, {}).get(lv, []):
                    key = it["q"].strip().lower()
                    if key in seen:
                        continue
                    seen.add(key)
                    new_lv = level_of(it["q"], origin, lv)
                    buckets[new_lv].append(it)
        # перемешать и подрезать до CAP на уровень
        out = {}
        for lv in ("easy", "medium", "hard"):
            random.shuffle(buckets[lv])
            out[lv] = buckets[lv][:CAP]
        result[theme] = out
        report[theme] = {lv: len(out[lv]) for lv in ("easy", "medium", "hard")}

    QFILE.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    for th, r in report.items():
        print(f"{th:14} easy={r['easy']:4} medium={r['medium']:4} hard={r['hard']:4}  всего={sum(r.values())}")
    print("Темы:", list(result.keys()))
    print("Всего:", sum(sum(r.values()) for r in report.values()))


if __name__ == "__main__":
    main()
