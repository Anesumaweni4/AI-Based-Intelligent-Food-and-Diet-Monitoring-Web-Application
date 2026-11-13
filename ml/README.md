# Machine learning for student diet monitoring

This folder trains the models behind THE KITCHEN's **Diet** page and the admin **Diet insights** view. Training runs offline in Python (scikit-learn). The trained models are saved as JSON (`models/diet_models.json`) and run inside the Node.js server, so the deployed app needs no Python.

## The pipeline

```
 menu + outside foods ──► foods.json ──► simulate.py ──► student_days.csv ──► train.py ──► diet_models.json ──► Node server
 (nutrition.js)           (npm run        (300 students    (18,000            (Model A +     (+ reports/)        (diet-model.js)
                          ml:export-foods)  x 60 days)       student-days)      Model B)
```

| File | Purpose |
| --- | --- |
| `diet_science.py` | Targets, daily diet score and weekly features. A line-by-line copy of sections 1-3 of `../diet-model.js` |
| `simulate.py` | Builds realistic food diaries from the real menu (see *Data* below) |
| `train.py` | Builds the dataset, trains and evaluates the models, and writes `models/` and `reports/` |
| `models/diet_models.json` | Trained models plus 25 test cases used by `npm run ml:test` |
| `reports/model_report.md` | Metrics tables and charts for the project report |

## 1. Personal targets (formula, not ML)

- **Energy:** Mifflin-St Jeor resting energy (10 × kg + 6.25 × cm − 5 × age, + 5 for males or − 161 for females), multiplied by an activity factor from the last 7 days' active minutes (1.4 / 1.55 / 1.7 / 1.85). The result is limited to 1,400-3,600 kcal.
- **Protein:** 0.8 g per kg of body weight (at least 45 g).
- **Fibre:** 25 g (WHO).
- **Sugar limit:** 10% of energy (WHO).
- **Fat:** under 35% of energy.
- **Activity:** 30 active minutes a day. Light minutes count as half, vigorous minutes count double.

## 2. Daily diet score (0-100)

| Part | Points | Full points when |
| --- | --- | --- |
| Energy | 25 | Intake is 90-110% of the target (falls to 0 at 50% or 150%) |
| Protein | 20 | The protein target is reached |
| Fibre | 15 | 25 g is reached |
| Sugar | 15 | At or under the limit (0 points at twice the limit) |
| Fat | 10 | Fat is 35% of energy or less (0 points at 50%) |
| Regular meals | 10 | Breakfast, lunch and supper (6 points) plus breakfast (4 points) |
| Activity | 5 | 30 active minutes |

## 3. Features (from the last 7 logged days)

`energy_ratio_mean`, `energy_ratio_std`, `protein_ratio_mean`, `fiber_ratio_mean`, `sugar_ratio_mean`, `fat_energy_pct_mean`, `meals_per_day_mean`, `breakfast_rate`, `late_meal_rate`, `active_minutes_mean`, `score_mean`, `score_trend` (slope over the week), `recent_score_mean` (last 3 logged days).

Days with nothing logged are treated as *not logged*, not as *ate nothing*. At least 3 logged days are needed.

## 4. Models

**Model A: eating patterns (unsupervised).** K-means on 9 standardised habit features. k is chosen by silhouette score (searched from 2 to 9, picked from 4-8 so the advice is specific). Each cluster is named automatically from its centre: *Balanced eater*, *Sugary-drink lover*, *Meal skipper* or *Fast-food & late-night eater*. Each name comes with a tip for the student and a "kitchen idea" for the admin.

**Model B: early warning (supervised).** Predicts whether the student's average diet score will be **below 55 over the next 7 days**.
- Four approaches are compared: a rule baseline (*last week's score < 55*), Logistic Regression, a Decision Tree and a Random Forest. All use class weighting because only about 14% of weeks are at risk.
- The data is split **by student** (75% / 25%), so the test set contains only students the models never saw. Models are compared with 5-fold GroupKFold on the training students.
- The model with the best cross-validated F1 is exported. Its alarm threshold is tuned on out-of-fold predictions from the training students only.

**Model C: recommendations (online, in `diet-model.js`).** Each menu item is scored by:
- how well it fills today's remaining energy, protein and fibre without adding much sugar or fat,
- a per-student logistic regression trained on that student's helpful / not helpful ratings,
- how often students with the same eating pattern bought it in the last 30 days.

## 5. Current results

From `reports/model_report.md` (seed 42):

| | Result |
| --- | --- |
| K-means | k = 4, silhouette 0.296. Agreement with the simulator's hidden habits (Adjusted Rand Index) 0.51; the models never see these labels |
| Rule baseline | Test F1 0.375, ROC AUC 0.801 |
| **Random Forest (chosen)** | Test accuracy 0.84, recall 0.60, precision 0.42, F1 0.50, **ROC AUC 0.87** |

The ROC AUC of 0.87 means the model ranks an at-risk week above a healthy one 87% of the time, clearly better than the rule. Precision is moderate because next week partly depends on events no model can see in advance (exams, money running out). A warning is therefore a prompt to check in, not a diagnosis.

## 6. Data

`simulate.py` creates 300 students over 60 days. Each student gets:
- a sex, an age (17-26), a height and a BMI-based weight;
- a hidden habit: balanced, fast food, sugary drinks, meal skipper, very active or over-eater;
- personal variation on top of that habit;
- weekend and end-of-month effects (money running short);
- random stressful spells (about one a month, lasting about 5 days) with skipped meals, more sugar and less activity;
- missed logging days (each student logs 60-99% of days).

Meals are picked from the real menu and the outside-food list, so nutrient totals use the same values as the app.

**Why simulated?** The app is new, so there are not yet months of real diaries. The same scripts retrain on real data once it exists: export real `diet_meal_logs` and `diet_activity_logs` into the `student_days.csv` format and run `train.py`.

## 7. Limitations

- Nutrition values are estimates from food composition tables, not lab analysis of THE KITCHEN's dishes.
- The model accuracy is measured on simulated students and must be re-measured on real diaries.
- The app gives general guidance for students in accommodation. It is not medical advice and does not diagnose eating disorders.

## Re-running

```powershell
python -m venv ml\.venv
ml\.venv\Scripts\python -m pip install -r ml\requirements.txt
npm.cmd run ml:train   # about 4 minutes
npm.cmd run ml:test    # Node vs Python parity check (553 checks)
```
