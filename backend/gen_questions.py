"""
Процедурный генератор вопросов для quiz-банка (Математика, Программирование, Физика).
Правильные ответы ВЫЧИСЛЯЮТСЯ на Python → корректность гарантирована, значения
уникальны. Вопросы разложены по уровням:
  easy   — школа до 9 класса
  medium — старшая школа / ЕГЭ
  hard   — ВУЗ / олимпиады / профи
Существующие вопросы сохраняются; генерируем добор до целевого объёма, дедуп по тексту.
Запуск: python gen_questions.py
"""
import json
import math
import random
from itertools import combinations
from pathlib import Path

random.seed(2025)
HERE = Path(__file__).parent
QFILE = HERE / "questions.json"
TARGET_PER_LEVEL = 340   # ~1020 на тему

# ---------- helpers ----------
def mkq(q, correct, wrongs):
    """Собирает вопрос: правильный + 3 разных неверных. Возвращает dict или None."""
    correct = str(correct)
    opts, seen = [correct], {correct}
    for w in wrongs:
        w = str(w)
        if w not in seen:
            opts.append(w); seen.add(w)
        if len(opts) == 4:
            break
    if len(opts) < 4:
        return None
    return {"q": q, "options": opts, "correct": 0}  # позиция перемешается на сервере


def num_wrongs(x, extra=None):
    """Правдоподобные неверные числовые варианты вокруг x."""
    cand = []
    if isinstance(x, int):
        for d in (1, -1, 2, -2, 10, -10, 5):
            cand.append(x + d)
        cand += [x * 2, x + 100 if x < 100 else x - 50]
    else:
        for d in (0.1, -0.1, 1, -1, 2):
            cand.append(round(x + d, 3))
        cand.append(round(x * 2, 3))
    if extra:
        cand = list(extra) + cand
    random.shuffle(cand)
    return [c for c in cand if c != x]


# ---------- МАТЕМАТИКА ----------
def gen_math():
    out = {"easy": [], "medium": [], "hard": []}
    R = random.Random(11)

    # easy: арифметика и школьная база
    for _ in range(60):
        a, b = R.randint(11, 99), R.randint(11, 99)
        out["easy"].append(mkq(f"Сколько будет {a} + {b}?", a + b, num_wrongs(a + b)))
    for _ in range(50):
        a, b = R.randint(30, 99), R.randint(2, 29); a = max(a, b + 1)
        out["easy"].append(mkq(f"Сколько будет {a} − {b}?", a - b, num_wrongs(a - b)))
    for _ in range(55):
        a, b = R.randint(3, 19), R.randint(3, 12)
        out["easy"].append(mkq(f"Сколько будет {a} × {b}?", a * b, num_wrongs(a * b)))
    for _ in range(45):
        b, q = R.randint(2, 12), R.randint(2, 12)
        out["easy"].append(mkq(f"Сколько будет {b * q} ÷ {b}?", q, num_wrongs(q)))
    for _ in range(30):
        a = R.randint(2, 25)
        out["easy"].append(mkq(f"Сколько будет {a}²?", a * a, num_wrongs(a * a)))
    for _ in range(20):
        a = R.randint(2, 10)
        out["easy"].append(mkq(f"Сколько будет {a}³?", a ** 3, num_wrongs(a ** 3)))
    for _ in range(30):
        p, n = R.choice([10, 20, 25, 50, 75]), R.choice([20, 40, 60, 80, 100, 200])
        v = n * p // 100
        out["easy"].append(mkq(f"Сколько будет {p}% от {n}?", v, num_wrongs(v)))
    for _ in range(30):
        a, b = R.randint(2, 20), R.randint(2, 20)
        out["easy"].append(mkq(f"Площадь прямоугольника {a}×{b}?", a * b, num_wrongs(a * b, [2 * (a + b), a + b])))
    for _ in range(25):
        a, b = R.randint(2, 20), R.randint(2, 20)
        out["easy"].append(mkq(f"Периметр прямоугольника со сторонами {a} и {b}?", 2 * (a + b), num_wrongs(2 * (a + b), [a * b])))
    for _ in range(25):
        a, d, n = R.randint(1, 9), R.randint(2, 6), R.randint(3, 5)
        seq = [a + d * i for i in range(n)]
        out["easy"].append(mkq(f"Продолжи ряд: {', '.join(map(str, seq))}, ?", a + d * n, num_wrongs(a + d * n)))
    for _ in range(20):
        b, x = R.randint(2, 30), R.randint(2, 30)
        out["easy"].append(mkq(f"Реши уравнение: x + {b} = {b + x}. x = ?", x, num_wrongs(x)))
    for _ in range(20):
        k = R.randint(1000, 9000)
        out["easy"].append(mkq(f"Сколько метров в {k // 1000} км?", (k // 1000) * 1000, num_wrongs((k // 1000) * 1000, [(k // 1000) * 100])))

    # medium: старшая школа / ЕГЭ
    for _ in range(40):
        a = R.choice([4, 9, 16, 25, 36, 49, 64, 81, 100, 121, 144, 169, 196, 225])
        out["medium"].append(mkq(f"Чему равен √{a}?", int(a ** 0.5), num_wrongs(int(a ** 0.5))))
    for _ in range(35):
        b, k = R.choice([2, 3, 5, 10]), R.randint(2, 5)
        out["medium"].append(mkq(f"Чему равен log_{b} {b ** k}?", k, num_wrongs(k)))
    for _ in range(35):
        a, n = R.randint(2, 6), R.randint(2, 6)
        out["medium"].append(mkq(f"Чему равно {a} в степени {n}?", a ** n, num_wrongs(a ** n)))
    trig = {(0, "sin"): "0", (30, "sin"): "1/2", (90, "sin"): "1", (0, "cos"): "1", (60, "cos"): "1/2", (90, "cos"): "0", (45, "sin"): "√2/2", (45, "cos"): "√2/2", (30, "cos"): "√3/2", (60, "sin"): "√3/2"}
    trig_vals = ["0", "1", "1/2", "√2/2", "√3/2", "-1"]
    for (deg, fn), val in trig.items():
        for _ in range(4):
            wr = [v for v in trig_vals if v != val]; R.shuffle(wr)
            out["medium"].append(mkq(f"Чему равен {fn} {deg}°?", val, wr))
    for _ in range(30):
        r = R.randint(2, 12)
        out["medium"].append(mkq(f"Площадь круга радиуса {r} (через π)?", f"{r * r}π", [f"{2 * r}π", f"{r}π", f"{r * r * r}π"]))
    for _ in range(30):
        b1, qq, n = R.randint(1, 4), R.randint(2, 3), R.randint(2, 5)
        term = b1 * qq ** (n - 1)
        out["medium"].append(mkq(f"Геом. прогрессия: b₁={b1}, q={qq}. Найди b_{n}.", term, num_wrongs(term)))
    for _ in range(25):
        a1, d, n = R.randint(1, 10), R.randint(2, 7), R.randint(4, 9)
        term = a1 + d * (n - 1)
        out["medium"].append(mkq(f"Арифм. прогрессия: a₁={a1}, d={d}. Найди a_{n}.", term, num_wrongs(term)))
    for _ in range(25):
        a, b = R.randint(2, 40), R.randint(2, 40)
        out["medium"].append(mkq(f"НОД({a}, {b}) = ?", math.gcd(a, b), num_wrongs(math.gcd(a, b))))
    for _ in range(25):
        a, b = R.randint(2, 20), R.randint(2, 20)
        lcm = a * b // math.gcd(a, b)
        out["medium"].append(mkq(f"НОК({a}, {b}) = ?", lcm, num_wrongs(lcm)))
    for _ in range(30):
        k, n = R.randint(1, 5), R.randint(6, 10)
        from math import gcd as g
        gg = g(k, n)
        out["medium"].append(mkq(f"Вероятность: {k} благоприятных из {n}. Ответ дробью.", f"{k // gg}/{n // gg}", [f"{n}/{k}", f"{k}/{n + 1}", f"{k + 1}/{n}"]))

    # hard: ВУЗ / олимпиады
    for _ in range(40):
        n, k = R.randint(4, 8), R.randint(1, 3)
        c = math.comb(n, k)
        out["hard"].append(mkq(f"Число сочетаний C({n},{k}) = ?", c, num_wrongs(c)))
    for _ in range(30):
        n = R.randint(3, 7)
        out["hard"].append(mkq(f"Чему равно {n}! (факториал)?", math.factorial(n), num_wrongs(math.factorial(n))))
    for _ in range(35):
        n = R.randint(2, 6)
        out["hard"].append(mkq(f"Производная x^{n} равна?", f"{n}·x^{n - 1}", [f"x^{n - 1}", f"{n}·x^{n}", f"{n - 1}·x^{n}"]))
    for _ in range(30):
        n = R.randint(5, 30)
        s = n * (n + 1) // 2
        out["hard"].append(mkq(f"Сумма чисел от 1 до {n} = ?", s, num_wrongs(s)))
    for _ in range(35):
        a, b, c, d = [R.randint(1, 9) for _ in range(4)]
        det = a * d - b * c
        out["hard"].append(mkq(f"Определитель матрицы [[{a}, {b}], [{c}, {d}]] = ?", det, num_wrongs(det)))
    for _ in range(30):
        a, b, m = R.randint(2, 6), R.randint(2, 5), R.choice([5, 7, 9, 10, 11])
        r = pow(a, b, m)
        out["hard"].append(mkq(f"Чему равно {a}^{b} mod {m}?", r, num_wrongs(r % m if r else 1)))
    for _ in range(30):
        a, b = R.randint(20, 90), R.randint(20, 90)
        out["hard"].append(mkq(f"НОД({a}, {b}) = ?", math.gcd(a, b), num_wrongs(math.gcd(a, b))))
    for _ in range(30):
        n = R.randint(3, 6)
        out["hard"].append(mkq(f"Число перестановок из {n} элементов (P_{n}) = ?", math.factorial(n), num_wrongs(math.factorial(n))))
    # добор коротких уровней (широкие шаблоны)
    for _ in range(70):
        a, b, c, d = [R.randint(1, 12) for _ in range(4)]
        det = a * d - b * c
        out["hard"].append(mkq(f"Определитель матрицы [[{a}, {b}], [{c}, {d}]]?", det, num_wrongs(det)))
    for _ in range(60):
        n = R.randint(11, 100); s = n * (n + 1) // 2
        out["hard"].append(mkq(f"Сумма всех натуральных чисел от 1 до {n}?", s, num_wrongs(s)))
    for _ in range(55):
        nums = [R.randint(1, 60) for _ in range(4)]
        while sum(nums) % 4: nums[0] += 1
        out["medium"].append(mkq(f"Среднее арифметическое чисел {', '.join(map(str, nums))}?", sum(nums) // 4, num_wrongs(sum(nums) // 4)))
    for _ in range(45):
        a, b = R.randint(10, 40), R.randint(2, 9)
        out["medium"].append(mkq(f"Чему равно {a}² − {b}²?", a * a - b * b, num_wrongs(a * a - b * b)))
    return out


# ---------- ПРОГРАММИРОВАНИЕ (реальный вывод Python) ----------
def gen_prog():
    out = {"easy": [], "medium": [], "hard": []}
    R = random.Random(22)

    def pv(expr, val):  # print value question
        return mkq(f"Что выведет print({expr})?", repr(val) if isinstance(val, str) else val,
                   num_wrongs(val) if isinstance(val, (int, float)) else [repr(val + "!"), "None", "Ошибка"])

    for _ in range(45):
        a, b = R.randint(2, 50), R.randint(2, 50)
        out["easy"].append(mkq(f"Что выведет print({a} + {b})?", a + b, num_wrongs(a + b)))
    for _ in range(35):
        a, b = R.randint(2, 12), R.randint(2, 12)
        out["easy"].append(mkq(f"Что выведет print({a} * {b})?", a * b, num_wrongs(a * b)))
    for _ in range(35):
        s1, s2 = R.choice(["a", "hello", "py", "код", "x"]), R.choice(["b", "world", "thon", "ер", "y"])
        out["easy"].append(mkq(f'Что выведет print("{s1}" + "{s2}")?', f'"{s1 + s2}"', [f'"{s1} {s2}"', f'"{s2 + s1}"', f'"{s1}+{s2}"']))
    for _ in range(30):
        s = R.choice(["Python", "hello", "программа", "код", "arena"])
        out["easy"].append(mkq(f'Что выведет print(len("{s}"))?', len(s), num_wrongs(len(s))))
    for _ in range(25):
        s, n = R.choice(["ab", "x", "hi", "*"]), R.randint(2, 5)
        out["easy"].append(mkq(f'Что выведет print("{s}" * {n})?', f'"{s * n}"', [f'"{s}{n}"', f'"{s * (n - 1)}"', '"' + s + '"']))
    for _ in range(30):
        a, b = R.randint(10, 99), R.randint(2, 9)
        out["easy"].append(mkq(f"Что выведет print({a} // {b})?", a // b, num_wrongs(a // b)))
    for _ in range(30):
        a, b = R.randint(10, 99), R.randint(2, 9)
        out["easy"].append(mkq(f"Что выведет print({a} % {b})?", a % b, num_wrongs(a % b)))
    for _ in range(20):
        typ = R.choice([("42", "int"), ("3.14", "float"), ('"hi"', "str"), ("True", "bool"), ("[1, 2]", "list")])
        out["easy"].append(mkq(f"Какой тип у значения {typ[0]}?", typ[1], [t for t in ["int", "float", "str", "bool", "list"] if t != typ[1]]))

    for _ in range(35):
        s = R.choice(["abcdef", "python", "arenagame", "profik"])
        i, j = sorted(R.sample(range(len(s) + 1), 2))
        out["medium"].append(mkq(f'Что выведет print("{s}"[{i}:{j}])?', f'"{s[i:j]}"', [f'"{s[i:j+1] if j < len(s) else s[i:j]}"', f'"{s[i-1:j] if i else s[i:j]}"', '""']))
    for _ in range(30):
        lst = [R.randint(1, 9) for _ in range(R.randint(3, 5))]
        i = R.randint(0, len(lst) - 1)
        out["medium"].append(mkq(f"Что выведет print({lst}[{i}])?", lst[i], num_wrongs(lst[i])))
    for _ in range(30):
        lst = [R.randint(1, 20) for _ in range(R.randint(3, 5))]
        out["medium"].append(mkq(f"Что выведет print(sorted({lst}))?", sorted(lst), [str(lst), str(sorted(lst, reverse=True)), str(lst[::-1])]))
    for _ in range(25):
        s = R.choice(["hello", "arena", "python"])
        out["medium"].append(mkq(f'Что выведет print("{s}".upper())?', f'"{s.upper()}"', [f'"{s}"', f'"{s.capitalize()}"', f'"{s.upper()[::-1]}"']))
    for _ in range(30):
        lst = [R.randint(1, 30) for _ in range(R.randint(3, 6))]
        out["medium"].append(mkq(f"Что выведет print(sum({lst}))?", sum(lst), num_wrongs(sum(lst))))
    for _ in range(25):
        lst = [R.randint(1, 50) for _ in range(R.randint(3, 6))]
        out["medium"].append(mkq(f"Что выведет print(max({lst}))?", max(lst), num_wrongs(max(lst), [min(lst)])))
    for _ in range(25):
        lst = [R.randint(1, 50) for _ in range(R.randint(3, 6))]
        out["medium"].append(mkq(f"Что выведет print(min({lst}))?", min(lst), num_wrongs(min(lst), [max(lst)])))
    for _ in range(25):
        a, b, c = R.randint(1, 9), R.randint(1, 9), R.randint(1, 9)
        expr = f"{a} > {b} and {b} < {c}"
        out["medium"].append(mkq(f"Что выведет print({expr})?", (a > b) and (b < c), ["None", "0", "1"] if True else []))
    for _ in range(20):
        a, b = R.randint(1, 20), R.randint(1, 20)
        out["medium"].append(mkq(f"Что выведет print({a} / {b})?", round(a / b, 4), [a // b, round(a / b) , round(b / a, 4)]))

    for _ in range(35):
        n = R.randint(3, 6)
        val = [x * x for x in range(n)]
        out["hard"].append(mkq(f"Что выведет print([x*x for x in range({n})])?", val, [str([x + x for x in range(n)]), str(list(range(n))), str([x * x for x in range(1, n + 1)])]))
    for _ in range(30):
        a, b = R.sample([1, 2, 3, 4, 5, 6, 7, 8], 2)
        s1, s2 = {a, b, R.randint(1, 8)}, {b, R.randint(1, 8)}
        out["hard"].append(mkq(f"Что выведет print({s1} & {s2})?", s1 & s2, [str(s1 | s2), str(s1 - s2), str(s2 - s1)]))
    for _ in range(25):
        parts = [R.choice(["a", "b", "c", "x", "y"]) for _ in range(3)]
        sep = R.choice(["-", ",", " "])
        out["hard"].append(mkq(f'Что выведет print("{sep}".join({parts}))?', f'"{sep.join(parts)}"', [f'"{"".join(parts)}"', str(parts), f'"{sep.join(parts[::-1])}"']))
    for _ in range(25):
        n = R.randint(2, 7)
        out["hard"].append(mkq(f"Что выведет print(2 ** {n})?", 2 ** n, num_wrongs(2 ** n)))
    for _ in range(25):
        lst = [R.randint(1, 9) for _ in range(R.randint(4, 6))]
        i, j = sorted(R.sample(range(len(lst) + 1), 2))
        out["hard"].append(mkq(f"Что выведет print({lst}[{i}:{j}])?", lst[i:j], [str(lst), str(lst[i:j + 1] if j < len(lst) else lst[i:j]), str(lst[::-1])]))
    for _ in range(20):
        val = R.choice([("bool(0)", False), ("bool('')", False), ("bool(5)", True), ("bool([])", False), ("bool('a')", True)])
        out["hard"].append(mkq(f"Что выведет print({val[0]})?", val[1], [(not val[1]), "None", "0"]))
    for _ in range(30):
        n = R.randint(2, 6)
        val = list(map(lambda z: z * 2, range(n)))
        out["hard"].append(mkq(f"Что выведет print(list(map(lambda z: z*2, range({n}))))?", val, [str(list(range(n))), str([x + 2 for x in range(n)]), str([x * 2 for x in range(1, n + 1)])]))
    # немного теории (сложность)
    theory_hard = [
        ("Сложность поиска элемента в списке (x in list)?", "O(n)", ["O(1)", "O(log n)", "O(n²)"]),
        ("Сложность доступа по индексу list[i]?", "O(1)", ["O(n)", "O(log n)", "O(n²)"]),
        ("Сложность поиска в словаре по ключу?", "O(1)", ["O(n)", "O(log n)", "O(n²)"]),
        ("Сложность пузырьковой сортировки?", "O(n²)", ["O(n)", "O(log n)", "O(n log n)"]),
        ("Сложность двоичного поиска?", "O(log n)", ["O(1)", "O(n)", "O(n²)"]),
        ("Сложность быстрой сортировки в среднем?", "O(n log n)", ["O(n)", "O(n²)", "O(log n)"]),
    ]
    for q, c, w in theory_hard:
        for _ in range(4):
            out["hard"].append(mkq(q, c, list(w)))
    # добор коротких уровней
    for _ in range(70):
        a, b = R.randint(2, 99), R.randint(2, 60); a = max(a, b)
        out["easy"].append(mkq(f"Что выведет print({a} - {b})?", a - b, num_wrongs(a - b)))
    for _ in range(45):
        a, b = R.randint(1, 40), R.randint(1, 40)
        out["easy"].append(mkq(f"Что выведет print({a} == {b})?", a == b, [not (a == b), "None", "1"]))
    for _ in range(55):
        n = R.randint(3, 8)
        val = [x for x in range(n) if x % 2 == 0]
        out["hard"].append(mkq(f"Что выведет print([x for x in range({n}) if x%2==0])?", val, [str(list(range(n))), str([x for x in range(n) if x % 2]), str([x * 2 for x in range(n)])]))
    for _ in range(45):
        d = {R.choice(["a", "b", "c", "x", "k"]): R.randint(1, 9) for _ in range(3)}
        k = R.choice(list(d))
        out["hard"].append(mkq(f"Что выведет print({d}[{k!r}])?", d[k], num_wrongs(d[k])))
    for _ in range(50):
        lst = [R.randint(1, 30) for _ in range(R.randint(2, 6))]
        out["medium"].append(mkq(f"Что выведет print(len({lst}))?", len(lst), num_wrongs(len(lst))))
    for _ in range(55):
        a, b, c = R.randint(1, 20), R.randint(1, 20), R.randint(1, 20)
        out["hard"].append(mkq(f"Что выведет print({a} if {a} > {b} else {c})?", a if a > b else c, num_wrongs(a if a > b else c)))
    return out


# ---------- ФИЗИКА ----------
def gen_phys():
    out = {"easy": [], "medium": [], "hard": []}
    R = random.Random(33)

    # EASY — кинематика и простые формулы (числовые, большое пространство параметров)
    for _ in range(80):
        v, t = R.randint(2, 40), R.randint(2, 30)
        out["easy"].append(mkq(f"Тело движется со скоростью {v} м/с в течение {t} с. Какой путь (м)?", v * t, num_wrongs(v * t, [v + t])))
    for _ in range(80):
        v, t = R.randint(2, 30), R.randint(2, 20)
        s = v * t
        out["easy"].append(mkq(f"Путь {s} м пройден за {t} с. Скорость (м/с)?", v, num_wrongs(v)))
    for _ in range(60):
        v, t = R.randint(2, 30), R.randint(2, 20)
        s = v * t
        out["easy"].append(mkq(f"Путь {s} м, скорость {v} м/с. Сколько времени в пути (с)?", t, num_wrongs(t)))
    for _ in range(70):
        m = R.randint(2, 60)
        out["easy"].append(mkq(f"Сила тяжести тела массой {m} кг (g=10 м/с²). F=mg (Н)?", m * 10, num_wrongs(m * 10)))
    for _ in range(40):
        kg = R.randint(2, 90)
        out["easy"].append(mkq(f"Сколько граммов в {kg} кг?", kg * 1000, num_wrongs(kg * 1000, [kg * 100])))
    units = [("силы", "Ньютон"), ("энергии и работы", "Джоуль"), ("мощности", "Ватт"),
             ("давления", "Паскаль"), ("частоты", "Герц"), ("заряда", "Кулон"),
             ("сопротивления", "Ом"), ("напряжения", "Вольт"), ("силы тока", "Ампер"), ("температуры (СИ)", "Кельвин")]
    allu = [u[1] for u in units]
    for name, u in units:
        wr = [x for x in allu if x != u]; R.shuffle(wr)
        out["easy"].append(mkq(f"В чём измеряется единица {name}?", u, wr))

    # MEDIUM — формулы ЕГЭ (числовые)
    for _ in range(55):
        m, a = R.randint(2, 30), R.randint(2, 15)
        out["medium"].append(mkq(f"Масса {m} кг, ускорение {a} м/с². Сила F=ma (Н)?", m * a, num_wrongs(m * a, [m + a])))
    for _ in range(45):
        V, ro = R.randint(2, 15), R.randint(2, 20) * 100
        m = ro * V
        out["medium"].append(mkq(f"Плотность {ro} кг/м³, объём {V} м³. Масса m=ρV (кг)?", m, num_wrongs(m)))
    for _ in range(45):
        t, P = R.randint(2, 20), R.randint(2, 50)
        A = P * t
        out["medium"].append(mkq(f"Работа {A} Дж за {t} с. Мощность P=A/t (Вт)?", P, num_wrongs(P)))
    for _ in range(50):
        Rr, I = R.randint(1, 20), R.randint(1, 15)
        U = I * Rr
        out["medium"].append(mkq(f"Напряжение {U} В, сопротивление {Rr} Ом. Ток I=U/R (А)?", I, num_wrongs(I)))
    for _ in range(45):
        m, h = R.randint(1, 20), R.randint(2, 20)
        E = m * 10 * h
        out["medium"].append(mkq(f"Потенц. энергия: m={m} кг, h={h} м, g=10. E=mgh (Дж)?", E, num_wrongs(E)))
    for _ in range(45):
        F, s = R.randint(2, 40), R.randint(2, 20)
        out["medium"].append(mkq(f"Сила {F} Н, путь {s} м. Работа A=F·s (Дж)?", F * s, num_wrongs(F * s, [F + s])))
    for _ in range(40):
        F, S = R.randint(10, 100), R.choice([2, 4, 5, 10])
        F = (F // S) * S
        out["medium"].append(mkq(f"Сила {F} Н давит на площадь {S} м². Давление P=F/S (Па)?", F // S, num_wrongs(F // S)))
    for _ in range(40):
        v, t = R.randint(4, 40), R.randint(2, 10)
        a = v // t if v % t == 0 else v
        v = a * t
        out["medium"].append(mkq(f"Скорость выросла с 0 до {v} м/с за {t} с. Ускорение a=v/t (м/с²)?", a, num_wrongs(a)))
    for _ in range(35):
        I, t = R.randint(2, 15), R.randint(2, 20)
        out["medium"].append(mkq(f"Ток {I} А течёт {t} с. Заряд q=I·t (Кл)?", I * t, num_wrongs(I * t)))
    for _ in range(35):
        U, I = R.randint(2, 20), R.randint(2, 12)
        out["medium"].append(mkq(f"Напряжение {U} В, ток {I} А. Мощность P=U·I (Вт)?", U * I, num_wrongs(U * I)))

    # HARD — энергия, импульс, ВУЗ
    for _ in range(55):
        m, v = R.randint(1, 10) * 2, R.randint(2, 12)
        E = m * v * v // 2
        out["hard"].append(mkq(f"Кинетич. энергия: m={m} кг, v={v} м/с. E=mv²/2 (Дж)?", E, num_wrongs(E)))
    for _ in range(55):
        m, v = R.randint(2, 30), R.randint(2, 20)
        out["hard"].append(mkq(f"Импульс тела: m={m} кг, v={v} м/с. p=mv (кг·м/с)?", m * v, num_wrongs(m * v)))
    for _ in range(45):
        P, t = R.randint(5, 60), R.randint(2, 20)
        out["hard"].append(mkq(f"Мощность {P} Вт работает {t} с. Энергия E=P·t (Дж)?", P * t, num_wrongs(P * t)))
    for _ in range(45):
        q, U = R.randint(2, 20), R.randint(2, 20)
        out["hard"].append(mkq(f"Заряд {q} Кл проходит напряжение {U} В. Работа A=q·U (Дж)?", q * U, num_wrongs(q * U)))
    for _ in range(45):
        r1, r2 = R.randint(1, 20), R.randint(1, 20)
        out["hard"].append(mkq(f"Два резистора {r1} Ом и {r2} Ом соединены последовательно. Общее сопротивление (Ом)?", r1 + r2, num_wrongs(r1 + r2, [abs(r1 - r2), r1 * r2])))
    for _ in range(40):
        lam, nu = R.choice([2, 3, 4, 5]), R.randint(2, 20)
        c = lam * nu
        out["hard"].append(mkq(f"Длина волны {lam} м, частота {nu} Гц. Скорость волны v=λ·ν (м/с)?", c, num_wrongs(c)))
    conc_hard = [
        ("В чём измеряется индуктивность?", "Генри", ["Тесла", "Фарад", "Ом"]),
        ("В чём измеряется магнитная индукция?", "Тесла", ["Генри", "Вебер", "Фарад"]),
        ("В чём измеряется электроёмкость?", "Фарад", ["Генри", "Тесла", "Кулон"]),
        ("Формула энергии фотона?", "E = h·ν", ["E = m·c²", "E = k·T", "E = q·U"]),
        ("Абсолютный ноль в °C?", "−273 °C", ["0 °C", "−100 °C", "−373 °C"]),
        ("Скорость света в вакууме?", "300 000 км/с", ["300 км/с", "3 000 км/с", "30 000 км/с"]),
        ("Скорость звука в воздухе?", "340 м/с", ["34 м/с", "3400 м/с", "300 000 км/с"]),
        ("Формула силы Архимеда?", "F = ρ·g·V", ["F = m·g", "F = ρ·V/g", "F = m·a"]),
        ("Первый закон термодинамики?", "Q = ΔU + A", ["Q = m·c·Δt", "Q = U·I·t", "Q = ΔU − A"]),
        ("Заряд электрона примерно?", "1,6·10⁻¹⁹ Кл", ["9,8 Кл", "6·10²³ Кл", "3·10⁸ Кл"]),
    ]
    for q, c, w in conc_hard:
        for _ in range(4):
            out["hard"].append(mkq(q, c, list(w)))
    # добор коротких уровней (числовые, широкие)
    for _ in range(60):
        a, t = R.randint(2, 9), R.randint(2, 20)
        v = a * t
        out["easy"].append(mkq(f"Тело разгоняется с ускорением {a} м/с² из покоя {t} с. Скорость v=at (м/с)?", v, num_wrongs(v)))
    for _ in range(80):
        F, s = R.randint(2, 50), R.randint(2, 25)
        out["hard"].append(mkq(f"Работа силы {F} Н на пути {s} м. A=F·s (Дж)?", F * s, num_wrongs(F * s, [F + s])))
    return out


def dedup_merge(existing, generated, target):
    """Существующие вопросы в приоритете, добираем генерированными до target на уровень."""
    result = {}
    for lv in ("easy", "medium", "hard"):
        seen = set()
        merged = []
        for it in existing.get(lv, []) + [g for g in generated.get(lv, []) if g]:
            key = it["q"].strip().lower()
            if key in seen:
                continue
            seen.add(key)
            merged.append(it)
        result[lv] = merged[:target]
    return result


def main():
    data = json.loads(QFILE.read_text(encoding="utf-8"))
    gens = {"mathematics": gen_math(), "programming": gen_prog(), "physics": gen_phys()}
    for theme, gen in gens.items():
        before = {lv: len(data[theme][lv]) for lv in ("easy", "medium", "hard")}
        data[theme] = dedup_merge(data[theme], gen, TARGET_PER_LEVEL)
        after = {lv: len(data[theme][lv]) for lv in ("easy", "medium", "hard")}
        tot = sum(after.values())
        print(f"{theme:14} было {sum(before.values()):4} → стало {tot:4}  ({after})")

    QFILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    grand = sum(len(data[t][lv]) for t in data for lv in ("easy", "medium", "hard"))
    print("Всего вопросов в банке:", grand)


if __name__ == "__main__":
    main()
