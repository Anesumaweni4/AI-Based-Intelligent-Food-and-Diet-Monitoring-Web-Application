"""Diet science definitions shared by the simulator and the trainer.

This file mirrors sections 1-3 of diet-model.js exactly (targets, daily diet
score, weekly features) so the models are trained on the same numbers the live
app computes. `npm run ml:test` checks the two implementations agree.
"""
import math

FIBRE_TARGET_G = 25
FAT_ENERGY_LIMIT = 0.35
ACTIVITY_TARGET_MIN = 30
SCORE_WEIGHTS = {"energy": 25, "protein": 20, "fiber": 15, "sugar": 15, "fat": 10, "regularity": 10, "activity": 5}
MIN_LOGGED_DAYS = 3
FEATURE_NAMES = [
    "energy_ratio_mean",
    "energy_ratio_std",
    "protein_ratio_mean",
    "fiber_ratio_mean",
    "sugar_ratio_mean",
    "fat_energy_pct_mean",
    "meals_per_day_mean",
    "breakfast_rate",
    "late_meal_rate",
    "active_minutes_mean",
    "score_mean",
    "score_trend",
    "recent_score_mean",
]


def js_round(value, places=1):
    """Same as JavaScript Math.round(value * 10^places) / 10^places."""
    factor = 10 ** places
    return math.floor(value * factor + 0.5) / factor


def clamp01(value):
    return max(0.0, min(1.0, value))


# 1. Targets -----------------------------------------------------------------
def activity_factor(average_active_minutes):
    minutes = float(average_active_minutes or 0)
    if minutes < 15:
        return 1.4
    if minutes < 30:
        return 1.55
    if minutes < 60:
        return 1.7
    return 1.85


def compute_targets(age, weight, height, sex, average_active_minutes=0):
    complete = age > 0 and weight > 0 and height > 0 and sex in ("female", "male")
    pal = activity_factor(average_active_minutes)
    if complete:
        bmr = 10 * weight + 6.25 * height - 5 * age + (5 if sex == "male" else -161)
        calories = bmr * pal
    else:
        bmr = None
        calories = 2000 if sex == "female" else 2500 if sex == "male" else 2200
    calories = math.floor(min(3600, max(1400, calories)) + 0.5)
    protein = math.floor(max(45, (weight if weight > 0 else 60) * 0.8) + 0.5)
    sugar_limit = math.floor((calories * 0.10) / 4 + 0.5)
    return {
        "calories": calories,
        "protein": protein,
        "fiber": FIBRE_TARGET_G,
        "sugarLimit": sugar_limit,
        "activityFactor": pal,
    }


# 2. Daily score ---------------------------------------------------------------
def score_day(day, targets):
    calories = float(day.get("calories") or 0)
    energy_ratio = calories / targets["calories"]
    if energy_ratio < 0.9:
        energy = clamp01((energy_ratio - 0.5) / 0.4)
    elif energy_ratio > 1.1:
        energy = clamp01((1.5 - energy_ratio) / 0.4)
    else:
        energy = 1.0
    protein_ratio = float(day.get("protein") or 0) / targets["protein"]
    fiber_ratio = float(day.get("fiber") or 0) / targets["fiber"]
    protein = clamp01(protein_ratio)
    fiber = clamp01(fiber_ratio)
    sugar_ratio = float(day.get("sugar") or 0) / targets["sugarLimit"]
    sugar = 1.0 if sugar_ratio <= 1 else clamp01(2 - sugar_ratio)
    fat_pct = (float(day.get("fat") or 0) * 9) / calories if calories > 0 else 0.0
    if calories <= 0:
        fat = 0.0
    elif fat_pct <= FAT_ENERGY_LIMIT:
        fat = 1.0
    else:
        fat = clamp01((0.5 - fat_pct) / (0.5 - FAT_ENERGY_LIMIT))
    meals = int(day.get("meals") or 0)
    meal_points = 6 if meals >= 3 else 4 if meals == 2 else 1 if meals == 1 else 0
    regularity = (meal_points + (4 if day.get("breakfast") else 0)) / 10
    activity = clamp01(float(day.get("activeMinutes") or 0) / ACTIVITY_TARGET_MIN)

    parts = [
        energy * SCORE_WEIGHTS["energy"],
        protein * SCORE_WEIGHTS["protein"],
        fiber * SCORE_WEIGHTS["fiber"],
        sugar * SCORE_WEIGHTS["sugar"],
        fat * SCORE_WEIGHTS["fat"],
        regularity * SCORE_WEIGHTS["regularity"],
        activity * SCORE_WEIGHTS["activity"],
    ]
    total = 0.0
    for part in parts:
        total += part
    return {
        "score": js_round(total, 1),
        "energy": js_round(energy_ratio, 3),
        "protein": js_round(protein_ratio, 3),
        "fiber": js_round(fiber_ratio, 3),
        "sugar": js_round(sugar_ratio, 3),
        "fat_pct": js_round(fat_pct, 3),
    }


# 3. Weekly features -------------------------------------------------------------
def _mean(values):
    if not values:
        return 0.0
    total = 0.0
    for value in values:
        total += value
    return total / len(values)


def _population_std(values):
    if len(values) < 2:
        return 0.0
    average = _mean(values)
    return math.sqrt(_mean([(value - average) ** 2 for value in values]))


def _slope(xs, ys):
    if len(xs) < 2:
        return 0.0
    x_mean = _mean(xs)
    y_mean = _mean(ys)
    numerator = 0.0
    denominator = 0.0
    for x, y in zip(xs, ys):
        numerator += (x - x_mean) * (y - y_mean)
        denominator += (x - x_mean) ** 2
    return 0.0 if denominator == 0 else numerator / denominator


def is_logged(day):
    return float(day.get("calories") or 0) > 0 or float(day.get("meals") or 0) > 0


def weekly_features(days, targets):
    logged = [day for day in days if is_logged(day)]
    if len(logged) < MIN_LOGGED_DAYS:
        return None
    scored = [(day, score_day(day, targets)) for day in logged]
    energy = [result["energy"] for _, result in scored]
    fat = [result["fat_pct"] for day, result in scored if float(day.get("calories") or 0) > 0]
    scores = [result["score"] for _, result in scored]
    values = [
        _mean(energy),
        _population_std(energy),
        _mean([min(2, result["protein"]) for _, result in scored]),
        _mean([min(2, result["fiber"]) for _, result in scored]),
        _mean([min(4, result["sugar"]) for _, result in scored]),
        _mean(fat),
        _mean([float(day.get("meals") or 0) for day in logged]),
        _mean([1.0 if day.get("breakfast") else 0.0 for day in logged]),
        _mean([1.0 if day.get("late") else 0.0 for day in logged]),
        _mean([min(180, float(day.get("activeMinutes") or 0)) for day in logged]),
        _mean(scores),
        _slope([float(day["dayIndex"]) for day in logged], scores),
        _mean(scores[-3:]),
    ]
    return [js_round(value, 4) for value in values]
