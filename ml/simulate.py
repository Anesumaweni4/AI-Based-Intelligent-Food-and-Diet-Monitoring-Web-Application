"""Simulate realistic food diaries for students living in accommodation.

Why simulate? The app is new, so there are not yet months of real diaries to
learn from. Each simulated student gets a body profile, a hidden eating habit
("persona") and day-to-day randomness: weekends, money running short at the end
of the month, and stressful spells (exams, deadlines) where meals are skipped
and sugary snacks go up. Meals are picked from the real THE KITCHEN menu and
common outside foods (ml/data/foods.json), so nutrient totals use the same
values as the live app. The persona is kept only to check the clustering later;
the models never see it.

Run:  python ml/simulate.py   (writes ml/data/student_days.csv)
"""
import csv
import json
import math
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEED = 42
STUDENTS = 300
DAYS = 60

PERSONAS = {
    # name: probabilities of each meal, food mix, drinks/snacks per day, activity
    "balanced": dict(breakfast=0.85, lunch=0.92, supper=0.92, late=0.08, staple=0.55, healthy=0.35, fried=0.10,
                     drinks=0.35, snacks=0.2, fruit=1.2, side_veg=0.45, active=42, portion=1.2, log=0.92),
    "fast_food": dict(breakfast=0.35, lunch=0.88, supper=0.85, late=0.45, staple=0.25, healthy=0.05, fried=0.70,
                      drinks=1.3, snacks=0.8, fruit=0.1, side_veg=0.05, active=20, portion=1.0, log=0.85),
    "sugar_drinker": dict(breakfast=0.55, lunch=0.85, supper=0.85, late=0.25, staple=0.5, healthy=0.12, fried=0.38,
                          drinks=2.6, snacks=1.1, fruit=0.2, side_veg=0.1, active=24, portion=1.0, log=0.85),
    "meal_skipper": dict(breakfast=0.12, lunch=0.5, supper=0.78, late=0.3, staple=0.6, healthy=0.1, fried=0.3,
                         drinks=0.6, snacks=0.7, fruit=0.1, side_veg=0.1, active=16, portion=0.9, log=0.8),
    "active": dict(breakfast=0.9, lunch=0.95, supper=0.95, late=0.15, staple=0.6, healthy=0.3, fried=0.1,
                   drinks=0.4, snacks=0.3, fruit=1.0, side_veg=0.35, active=80, portion=1.4, log=0.9),
    "overeater": dict(breakfast=0.7, lunch=0.98, supper=0.98, late=0.55, staple=0.45, healthy=0.08, fried=0.47,
                      drinks=1.0, snacks=1.4, fruit=0.2, side_veg=0.1, active=8, portion=1.35, log=0.85),
}
PERSONA_SHARE = {"balanced": 0.24, "fast_food": 0.17, "sugar_drinker": 0.15, "meal_skipper": 0.16,
                 "active": 0.12, "overeater": 0.16}

FRIED_PARTS = ("chips", "burger", "cheeseburger", "hotdog", "russian sausage", "boerewors", "potato wedges")
VEG_PARTS = ("salad", "vegetables", "coleslaw", "beans")


def load_foods():
    data = json.loads((HERE / "data" / "foods.json").read_text(encoding="utf-8"))
    foods = data["foods"]
    groups = {"fried": [], "healthy": [], "staple": [], "side_veg": [], "sugary_drink": [], "water": [],
              "breakfast": [], "snack": [], "fruit": []}
    breakfast_keys = {"bread-margarine", "peanut-butter-sandwich", "tea-sugar", "porridge", "eggs", "banana",
                      "milk", "apple-orange", "yoghurt"}
    snack_keys = {"biscuits", "crisps", "fat-cakes", "maputi", "instant-noodles"}
    fruit_keys = {"banana", "apple-orange", "yoghurt"}
    for food in foods:
        parts = food.get("components") or []
        if food["source"] == "outside":
            if food["id"] in breakfast_keys:
                groups["breakfast"].append(food)
            if food["id"] in snack_keys:
                groups["snack"].append(food)
            if food["id"] in fruit_keys:
                groups["fruit"].append(food)
            if food["id"] in ("home-sadza-veg", "home-rice-beans"):
                groups["healthy"].append(food)
            if food["id"] in ("soft-drink-outside", "maheu"):
                groups["sugary_drink"].append(food)
            continue
        if food["isDrink"]:
            (groups["water"] if food["calories"] == 0 else groups["sugary_drink"] if food["sugar"] > 15 else groups["water"]).append(food)
            continue
        if food["name"].lower() == "cake":
            groups["snack"].append(food)
            continue
        if any(part in FRIED_PARTS for part in parts):
            groups["fried"].append(food)
        elif len(parts) == 1 and parts[0] in VEG_PARTS:
            groups["side_veg"].append(food)
        elif any(part in VEG_PARTS for part in parts) or food["fiber"] >= 6:
            groups["healthy"].append(food)
        elif len(parts) >= 2:
            groups["staple"].append(food)
    return groups


def poisson(rng, lam):
    # Knuth's algorithm; fine for the small rates used here
    limit = math.exp(-lam)
    k, p = 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def make_student(rng, student_id):
    persona = rng.choices(list(PERSONA_SHARE), weights=list(PERSONA_SHARE.values()))[0]
    sex = rng.choice(["female", "male"])
    age = rng.randint(17, 26)
    height = rng.gauss(172, 7) if sex == "male" else rng.gauss(162, 6)
    bmi = min(34, max(17, rng.gauss(22.5, 3.2) + (2.0 if persona == "overeater" else 0)))
    weight = bmi * (height / 100) ** 2
    params = dict(PERSONAS[persona])
    # personal variation so students with the same habit are not identical
    for key in ("breakfast", "lunch", "supper", "late"):
        params[key] = min(0.99, max(0.02, params[key] + rng.gauss(0, 0.07)))
    params["drinks"] = max(0.05, params["drinks"] * rng.uniform(0.75, 1.25))
    params["active"] = max(3, params["active"] * rng.uniform(0.7, 1.3))
    params["log"] = min(0.99, max(0.6, params["log"] + rng.gauss(0, 0.05)))
    return {"student_id": student_id, "persona": persona, "sex": sex, "age": age,
            "height": round(height, 1), "weight": round(weight, 1), "params": params}


def pick_meal(rng, groups, params, stressed):
    weights = [params["staple"], params["healthy"], params["fried"] + (0.15 if stressed else 0)]
    group = rng.choices(["staple", "healthy", "fried"], weights=weights)[0]
    return rng.choice(groups[group])


def simulate_day(rng, groups, student, day, stressed):
    p = student["params"]
    weekday = day % 7  # 5, 6 = weekend
    month_end = (day % 30) >= 25
    foods = []  # (food, servings, slot)

    breakfast_p = p["breakfast"] - (0.25 if stressed else 0) - (0.1 if weekday >= 5 else 0)
    lunch_p = p["lunch"] - (0.2 if stressed else 0) - (0.15 if month_end else 0)
    supper_p = p["supper"] - (0.1 if stressed else 0) - (0.05 if month_end else 0)
    late_p = p["late"] + (0.2 if stressed else 0) + (0.1 if weekday >= 5 else 0)
    portion = p["portion"] * rng.uniform(0.85, 1.15)

    if rng.random() < breakfast_p:
        for _ in range(rng.choice([1, 2, 2, 3])):
            foods.append((rng.choice(groups["breakfast"]), 1.0, "breakfast"))
    for slot, chance in (("lunch", lunch_p), ("supper", supper_p)):
        if rng.random() < chance:
            foods.append((pick_meal(rng, groups, p, stressed), round(portion * 2) / 2 or 0.5, slot))
            if rng.random() < p["side_veg"]:
                foods.append((rng.choice(groups["side_veg"]), 1.0, slot))
    if rng.random() < late_p:
        late_group = "snack" if rng.random() < 0.55 else "fried"
        foods.append((rng.choice(groups[late_group]), 1.0, "late"))

    drink_rate = p["drinks"] * (1.5 if stressed else 1.0)
    for _ in range(poisson(rng, drink_rate)):
        foods.append((rng.choice(groups["sugary_drink"]), 1.0, rng.choice(["lunch", "supper", "snack"])))
    for _ in range(poisson(rng, p["snacks"] * (1.4 if stressed else 1.0))):
        foods.append((rng.choice(groups["snack"]), 1.0, "snack"))
    for _ in range(poisson(rng, p["fruit"])):
        foods.append((rng.choice(groups["fruit"]), 1.0, "snack"))
    if rng.random() < 0.5:
        foods.append((rng.choice(groups["water"]), 1.0, "snack"))

    totals = {key: 0.0 for key in ("calories", "protein", "carbohydrates", "fat", "fiber", "sugar")}
    for food, servings, _ in foods:
        for key in totals:
            totals[key] += food[key] * servings
    meal_slots = {slot for food, _, slot in foods if not food["isDrink"] and slot in ("breakfast", "lunch", "supper")}
    late = any(slot == "late" and not food["isDrink"] for food, _, slot in foods)

    active_mean = p["active"] * (0.5 if stressed else 1.0) * (1.2 if weekday >= 5 else 1.0)
    active = 0 if rng.random() < 0.15 else max(0, rng.gammavariate(2.0, active_mean / 2.0))
    return {
        **{key: round(value, 1) for key, value in totals.items()},
        "meals": len(meal_slots),
        "breakfast": int("breakfast" in meal_slots),
        "late": int(late),
        "activeMinutes": round(active),
        "items": len(foods),
    }


def main():
    rng = random.Random(SEED)
    groups = load_foods()
    for name, items in groups.items():
        if not items:
            raise SystemExit(f"No foods found for group {name!r}; check ml/data/foods.json")

    out_file = HERE / "data" / "student_days.csv"
    fields = ["student_id", "persona", "sex", "age", "height", "weight", "day", "logged", "stressed",
              "calories", "protein", "carbohydrates", "fat", "fiber", "sugar",
              "meals", "breakfast", "late", "activeMinutes"]
    with out_file.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for student_id in range(1, STUDENTS + 1):
            student = make_student(rng, student_id)
            stressed = False
            for day in range(DAYS):
                # stressful spells start about once a month and last ~5 days
                stressed = (rng.random() > 0.2) if stressed else (rng.random() < 0.035)
                record = simulate_day(rng, groups, student, day, stressed)
                logged = rng.random() < student["params"]["log"]
                row = {
                    "student_id": student_id, "persona": student["persona"], "sex": student["sex"],
                    "age": student["age"], "height": student["height"], "weight": student["weight"],
                    "day": day, "logged": int(logged), "stressed": int(stressed),
                    "activeMinutes": record["activeMinutes"],
                }
                if logged:
                    row.update({key: record[key] for key in ("calories", "protein", "carbohydrates", "fat", "fiber",
                                                              "sugar", "meals", "breakfast", "late")})
                else:
                    # food not logged that day: the app sees no meals (activity check-ins still count)
                    row.update({key: 0 for key in ("calories", "protein", "carbohydrates", "fat", "fiber",
                                                   "sugar", "meals", "breakfast", "late")})
                writer.writerow(row)
    print(f"Wrote {STUDENTS} students x {DAYS} days to {out_file.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main()
