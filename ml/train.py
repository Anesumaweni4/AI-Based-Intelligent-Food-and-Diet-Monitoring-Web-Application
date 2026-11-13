"""Train the diet monitoring models and write the evaluation report.

Model A - eating-pattern clustering (K-means, k chosen by silhouette score)
Model B - diet-risk prediction: will the student's diet score average below
          55/100 over the next 7 days? Compares a simple rule baseline,
          Logistic Regression, a Decision Tree and a Random Forest using
          student-grouped cross-validation, then tests the best on students
          the models have never seen.

Outputs
  ml/models/diet_models.json   - models the Node server loads
  ml/reports/*.png             - charts for the project report
  ml/reports/model_report.md   - metrics tables and explanation
  ml/reports/metrics.json      - raw metrics

Run:  python ml/train.py
"""
import json
import random
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, adjusted_rand_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score, roc_curve, silhouette_score)
from sklearn.model_selection import GroupKFold, GroupShuffleSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

from diet_science import FEATURE_NAMES, compute_targets, is_logged, score_day, weekly_features

HERE = Path(__file__).resolve().parent
REPORTS = HERE / "reports"
MODELS = HERE / "models"
SEED = 42
WINDOW = 7
HORIZON = 7
RISK_SCORE = 55
CLUSTER_FEATURES = ["energy_ratio_mean", "protein_ratio_mean", "fiber_ratio_mean", "sugar_ratio_mean",
                    "fat_energy_pct_mean", "meals_per_day_mean", "breakfast_rate", "late_meal_rate",
                    "active_minutes_mean"]
PALETTE = ["#a24a30", "#2f6f9f", "#3f7a52", "#b7791f", "#7a4fa0", "#5b6b73", "#c0703f", "#2e8b8b"]


# ---------------------------------------------------------------------------
# Dataset: one row per student per 7-day window
# ---------------------------------------------------------------------------
def to_day(row, day_index):
    return {
        "dayIndex": day_index,
        "calories": row.calories, "protein": row.protein, "fiber": row.fiber,
        "sugar": row.sugar, "fat": row.fat, "meals": int(row.meals),
        "breakfast": bool(row.breakfast), "late": bool(row.late),
        "activeMinutes": row.activeMinutes,
    }


def build_windows(days):
    rows = []
    for student_id, student in days.groupby("student_id"):
        student = student.sort_values("day")
        records = list(student.itertuples(index=False))
        first = records[0]
        for end in range(WINDOW, len(records) - HORIZON + 1):
            window = [to_day(record, index) for index, record in enumerate(records[end - WINDOW:end])]
            future = [to_day(record, index) for index, record in enumerate(records[end:end + HORIZON])]
            average_active = sum(day["activeMinutes"] for day in window) / WINDOW
            targets = compute_targets(first.age, first.weight, first.height, first.sex, average_active)
            features = weekly_features(window, targets)
            future_logged = [day for day in future if is_logged(day)]
            if features is None or len(future_logged) < 4:
                continue
            future_score = float(np.mean([score_day(day, targets)["score"] for day in future_logged]))
            rows.append({
                "student_id": student_id, "persona": first.persona, "end_day": end,
                **dict(zip(FEATURE_NAMES, features)),
                "future_score": future_score,
                "at_risk": int(future_score < RISK_SCORE),
                "_window": window, "_targets": targets,
            })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Model A: clustering
# ---------------------------------------------------------------------------
LABELS = {
    "Balanced eater": dict(
        description="Regular meals with a good mix of energy, protein and fibre.",
        tip="Keep it up. Add a fruit or a side salad on busy days to stay on track."),
    "Sugary-drink lover": dict(
        description="Much of the day's sugar comes from soft drinks, juices and snacks.",
        tip="Swap one soft drink a day for water. One 500 ml soft drink has about 53 g of sugar."),
    "Fast-food & late-night eater": dict(
        description="Fried foods such as chips and burgers make up many meals, portions are large and eating often happens late at night.",
        tip="Choose rice or sadza instead of chips twice a week, add a vegetable side and keep late-night snacks small."),
    "Meal skipper": dict(
        description="Breakfast and lunch are often missed, so the body runs short of energy and protein.",
        tip="Start with a quick breakfast (porridge, eggs or a peanut butter sandwich) before lectures."),
    "Active and well-fuelled": dict(
        description="Very active with enough energy and protein to match.",
        tip="Great balance. Keep drinking water and include a protein food after exercise."),
    "Night-time overeater": dict(
        description="Eats well over daily energy needs, with late-night snacks and little activity.",
        tip="Aim for a 30-minute walk most days and keep late-night snacks small."),
    "Under-eater": dict(
        description="Eats clearly less than the body needs most days.",
        tip="Add a third meal or a filling snack such as beans, eggs or peanut butter bread."),
}


def label_scores(profile):
    """How well each label describes a cluster profile (higher = better)."""
    p = profile
    return {
        "Balanced eater": p["score_mean"] / 10 - abs(p["energy_ratio_mean"] - 1) * 4,
        "Sugary-drink lover": (p["sugar_ratio_mean"] - 1) * 4,
        "Fast-food & late-night eater": (p["fat_energy_pct_mean"] - 0.33) * 40 + p["late_meal_rate"] * 2,
        "Meal skipper": (2.6 - p["meals_per_day_mean"]) * 3 + (0.6 - p["breakfast_rate"]) * 4,
        "Active and well-fuelled": (p["active_minutes_mean"] - 35) / 8 + (p["protein_ratio_mean"] - 1) * 3,
        "Night-time overeater": (p["energy_ratio_mean"] - 1.1) * 8 + p["late_meal_rate"] * 2 - p["active_minutes_mean"] / 30,
        "Under-eater": (0.85 - p["energy_ratio_mean"]) * 10,
    }


def name_clusters(profiles):
    """Give every cluster a different, best-fitting label (greedy assignment)."""
    candidates = []
    for cluster_id, profile in profiles.items():
        for label, value in label_scores(profile).items():
            candidates.append((value, cluster_id, label))
    names, used = {}, set()
    for value, cluster_id, label in sorted(candidates, reverse=True):
        if cluster_id in names or label in used:
            continue
        names[cluster_id] = label
        used.add(label)
    return names


def train_clustering(windows):
    X = windows[CLUSTER_FEATURES].to_numpy()
    scaler = StandardScaler().fit(X)
    Xs = scaler.transform(X)
    rng = np.random.default_rng(SEED)
    sample = rng.choice(len(Xs), size=min(4000, len(Xs)), replace=False)

    search = []
    for k in range(2, 10):
        model = KMeans(n_clusters=k, n_init=10, random_state=SEED).fit(Xs)
        search.append({"k": k, "inertia": float(model.inertia_),
                       "silhouette": float(silhouette_score(Xs[sample], model.labels_[sample]))})
    # at least 4 groups so the advice is specific enough to act on
    best = max((row for row in search if 4 <= row["k"] <= 8), key=lambda row: row["silhouette"])
    k = best["k"]
    model = KMeans(n_clusters=k, n_init=20, random_state=SEED).fit(Xs)
    windows = windows.assign(cluster=model.labels_)

    profiles = {cid: windows[windows.cluster == cid][FEATURE_NAMES].mean().to_dict() for cid in range(k)}
    names = name_clusters(profiles)
    ari = float(adjusted_rand_score(windows.persona, windows.cluster))
    crosstab = pd.crosstab(windows.cluster.map(names), windows.persona)

    # Charts
    fig, ax1 = plt.subplots(figsize=(7, 4))
    ks = [row["k"] for row in search]
    ax1.plot(ks, [row["inertia"] for row in search], "o-", color=PALETTE[0], label="Inertia (elbow)")
    ax1.set_xlabel("Number of clusters (k)")
    ax1.set_ylabel("Inertia", color=PALETTE[0])
    ax2 = ax1.twinx()
    ax2.plot(ks, [row["silhouette"] for row in search], "s--", color=PALETTE[1], label="Silhouette")
    ax2.set_ylabel("Silhouette score", color=PALETTE[1])
    ax2.axvline(k, color="#999", linestyle=":")
    ax1.set_title(f"Choosing k for K-means (chosen k = {k})")
    fig.tight_layout()
    fig.savefig(REPORTS / "kmeans_k_selection.png", dpi=150)
    plt.close(fig)

    pca = PCA(n_components=2, random_state=SEED).fit(Xs)
    points = pca.transform(Xs[sample])
    fig, ax = plt.subplots(figsize=(7, 5.5))
    for cid in range(k):
        mask = model.labels_[sample] == cid
        ax.scatter(points[mask, 0], points[mask, 1], s=8, alpha=0.55, color=PALETTE[cid % len(PALETTE)], label=names[cid])
    centres = pca.transform(model.cluster_centers_)
    ax.scatter(centres[:, 0], centres[:, 1], marker="X", s=160, color="black")
    ax.set_xlabel(f"PC1 ({pca.explained_variance_ratio_[0]:.0%} of variance)")
    ax.set_ylabel(f"PC2 ({pca.explained_variance_ratio_[1]:.0%} of variance)")
    ax.set_title("Eating-pattern clusters (PCA projection)")
    ax.legend(fontsize=8, markerscale=2)
    fig.tight_layout()
    fig.savefig(REPORTS / "clusters_pca.png", dpi=150)
    plt.close(fig)

    centroid_table = pd.DataFrame(scaler.inverse_transform(model.cluster_centers_), columns=CLUSTER_FEATURES)
    centroid_table.index = [names[cid] for cid in range(k)]
    fig, ax = plt.subplots(figsize=(10, 0.6 * k + 1.8))
    z = (centroid_table - centroid_table.mean()) / centroid_table.std(ddof=0).replace(0, 1)
    image = ax.imshow(z.to_numpy(), cmap="RdBu_r", vmin=-2, vmax=2, aspect="auto")
    ax.set_xticks(range(len(CLUSTER_FEATURES)), [name.replace("_", " ") for name in CLUSTER_FEATURES], rotation=35, ha="right", fontsize=8)
    ax.set_yticks(range(k), centroid_table.index, fontsize=9)
    for i in range(k):
        for j, feature in enumerate(CLUSTER_FEATURES):
            ax.text(j, i, f"{centroid_table.iloc[i, j]:.2f}", ha="center", va="center", fontsize=7)
    fig.colorbar(image, ax=ax, label="Relative to other clusters (z)")
    ax.set_title("Cluster profiles (cluster centres in real units)")
    fig.tight_layout()
    fig.savefig(REPORTS / "cluster_profiles.png", dpi=150)
    plt.close(fig)

    clusters_json = []
    for cid in range(k):
        clusters_json.append({
            "id": cid, "name": names[cid], **LABELS[names[cid]],
            "size": int((windows.cluster == cid).sum()),
            "profile": {key: round(float(value), 3) for key, value in profiles[cid].items()},
        })
    return windows, {
        "algorithm": "kmeans", "k": k,
        "featureIndexes": [FEATURE_NAMES.index(name) for name in CLUSTER_FEATURES],
        "featureNames": CLUSTER_FEATURES,
        "mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist(),
        "centroids": model.cluster_centers_.tolist(),
        "clusters": clusters_json,
        "silhouette": round(best["silhouette"], 3),
        "adjustedRandIndexVsHiddenPersona": round(ari, 3),
        "kSearch": search,
    }, crosstab


# ---------------------------------------------------------------------------
# Model B: risk prediction
# ---------------------------------------------------------------------------
def metrics(y_true, probability, threshold=0.5):
    predicted = (probability >= threshold).astype(int)
    return {
        "accuracy": round(float(accuracy_score(y_true, predicted)), 3),
        "precision": round(float(precision_score(y_true, predicted, zero_division=0)), 3),
        "recall": round(float(recall_score(y_true, predicted, zero_division=0)), 3),
        "f1": round(float(f1_score(y_true, predicted, zero_division=0)), 3),
        "rocAuc": round(float(roc_auc_score(y_true, probability)), 3) if len(set(y_true)) > 1 else None,
    }


class RuleBaseline:
    """Not ML: 'at risk if last week's average score was below 55'."""
    def fit(self, X, y):
        return self

    def predict_proba(self, X):
        score_mean = X[:, FEATURE_NAMES.index("score_mean")]
        probability = np.clip((RISK_SCORE + 10 - score_mean) / 20, 0, 1)
        return np.column_stack([1 - probability, probability])


def candidate_models():
    return {
        "Rule baseline (last week score < 55)": RuleBaseline(),
        "Logistic Regression": make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, class_weight="balanced")),
        "Decision Tree": DecisionTreeClassifier(max_depth=5, min_samples_leaf=30, class_weight="balanced", random_state=SEED),
        "Random Forest": RandomForestClassifier(n_estimators=60, max_depth=7, min_samples_leaf=20,
                                                class_weight="balanced", random_state=SEED, n_jobs=-1),
    }


def export_tree(tree):
    t = tree.tree_
    values = t.value[:, 0, :]
    probability = values[:, 1] / np.maximum(values.sum(axis=1), 1e-12)
    return {
        "left": t.children_left.tolist(), "right": t.children_right.tolist(),
        "feature": t.feature.tolist(), "threshold": t.threshold.tolist(),
        "value": [round(float(p), 5) for p in probability],
    }


def train_risk(windows):
    X = windows[FEATURE_NAMES].to_numpy()
    y = windows.at_risk.to_numpy()
    groups = windows.student_id.to_numpy()

    split = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=SEED)
    train_index, test_index = next(split.split(X, y, groups))
    X_train, X_test, y_train, y_test = X[train_index], X[test_index], y[train_index], y[test_index]

    cv = GroupKFold(n_splits=5)
    comparison = []
    for name, model in candidate_models().items():
        fold_scores = []
        for fold_train, fold_valid in cv.split(X_train, y_train, groups[train_index]):
            model.fit(X_train[fold_train], y_train[fold_train])
            fold_scores.append(metrics(y_train[fold_valid], model.predict_proba(X_train[fold_valid])[:, 1]))
        cv_mean = {key: round(float(np.mean([fold[key] for fold in fold_scores])), 3) for key in fold_scores[0]}
        cv_std = round(float(np.std([fold["f1"] for fold in fold_scores])), 3)
        model.fit(X_train, y_train)
        test = metrics(y_test, model.predict_proba(X_test)[:, 1])
        comparison.append({"model": name, "cv": cv_mean, "cvF1Std": cv_std, "test": test, "_model": model})

    ml_models = [row for row in comparison if not row["model"].startswith("Rule")]
    best = max(ml_models, key=lambda row: (row["cv"]["f1"], row["cv"]["rocAuc"]))
    best_model = best["_model"]

    # Pick the alarm threshold on the training students only (out-of-fold predictions)
    out_of_fold = np.zeros(len(train_index))
    for fold_train, fold_valid in cv.split(X_train, y_train, groups[train_index]):
        fold_model = candidate_models()[best["model"]]
        fold_model.fit(X_train[fold_train], y_train[fold_train])
        out_of_fold[fold_valid] = fold_model.predict_proba(X_train[fold_valid])[:, 1]
    thresholds = np.round(np.arange(0.3, 0.81, 0.02), 2)
    threshold_f1 = [f1_score(y_train, (out_of_fold >= t).astype(int), zero_division=0) for t in thresholds]
    threshold = float(thresholds[int(np.argmax(threshold_f1))])
    best_probability = best_model.predict_proba(X_test)[:, 1]
    best["testTuned"] = metrics(y_test, best_probability, threshold)

    # Charts: model comparison, ROC curves, confusion matrix, feature importance
    fig, ax = plt.subplots(figsize=(8, 4))
    names = [row["model"].replace(" (last week score < 55)", "\n(rule)") for row in comparison]
    width = 0.2
    for offset, key in enumerate(["accuracy", "precision", "recall", "f1"]):
        ax.bar(np.arange(len(comparison)) + (offset - 1.5) * width, [row["test"][key] for row in comparison],
               width, label=key.capitalize() if key != "f1" else "F1", color=PALETTE[offset])
    ax.set_xticks(range(len(comparison)), names, fontsize=8)
    ax.set_ylim(0, 1)
    ax.set_ylabel("Score on unseen students")
    ax.set_title("Diet-risk model comparison (test set)")
    ax.legend(fontsize=8, ncol=4, loc="lower center")
    fig.tight_layout()
    fig.savefig(REPORTS / "risk_model_comparison.png", dpi=150)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(5.5, 5))
    for index, row in enumerate(comparison):
        fpr, tpr, _ = roc_curve(y_test, row["_model"].predict_proba(X_test)[:, 1])
        ax.plot(fpr, tpr, color=PALETTE[index], label=f"{row['model'].split(' (')[0]} (AUC {row['test']['rocAuc']})")
    ax.plot([0, 1], [0, 1], ":", color="#999")
    ax.set_xlabel("False positive rate")
    ax.set_ylabel("True positive rate")
    ax.set_title("ROC curves (test set)")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(REPORTS / "risk_roc_curves.png", dpi=150)
    plt.close(fig)

    matrix = confusion_matrix(y_test, (best_probability >= threshold).astype(int))
    fig, ax = plt.subplots(figsize=(4.5, 4))
    ax.imshow(matrix, cmap="Oranges")
    for i in range(2):
        for j in range(2):
            ax.text(j, i, str(matrix[i, j]), ha="center", va="center", fontsize=14)
    ax.set_xticks([0, 1], ["Predicted OK", "Predicted at risk"])
    ax.set_yticks([0, 1], ["Actually OK", "Actually at risk"])
    ax.set_title(f"Confusion matrix - {best['model']}")
    fig.tight_layout()
    fig.savefig(REPORTS / "risk_confusion_matrix.png", dpi=150)
    plt.close(fig)

    if best["model"] == "Logistic Regression":
        importance = np.abs(best_model[-1].coef_[0])
    else:
        importance = best_model.feature_importances_
    importance = importance / importance.sum()
    order = np.argsort(importance)
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.barh([FEATURE_NAMES[i].replace("_", " ") for i in order], importance[order], color=PALETTE[0])
    ax.set_xlabel("Relative importance")
    ax.set_title(f"What drives the risk prediction ({best['model']})")
    fig.tight_layout()
    fig.savefig(REPORTS / "risk_feature_importance.png", dpi=150)
    plt.close(fig)

    # Export the chosen model
    risk_json = {
        "label": best["model"],
        "threshold": threshold,
        "featureIndexes": list(range(len(FEATURE_NAMES))),
        "riskScoreThreshold": RISK_SCORE,
        "horizonDays": HORIZON,
        "metrics": best["testTuned"],
        "metricsAtHalf": best["test"],
        "comparison": [{key: value for key, value in row.items() if key != "_model"} for row in comparison],
        "featureImportance": {FEATURE_NAMES[i]: round(float(importance[i]), 4) for i in range(len(FEATURE_NAMES))},
        "trainRows": int(len(train_index)), "testRows": int(len(test_index)),
    }
    if best["model"] == "Logistic Regression":
        scaler, classifier = best_model[0], best_model[-1]
        risk_json.update(algorithm="logistic_regression", mean=scaler.mean_.tolist(), scale=scaler.scale_.tolist(),
                         coef=classifier.coef_[0].tolist(), intercept=float(classifier.intercept_[0]))
    elif best["model"] == "Decision Tree":
        risk_json.update(algorithm="decision_tree", trees=[export_tree(best_model)])
    else:
        risk_json.update(algorithm="random_forest", trees=[export_tree(tree) for tree in best_model.estimators_])
    return risk_json, best_model, matrix


# ---------------------------------------------------------------------------
def main():
    REPORTS.mkdir(exist_ok=True)
    MODELS.mkdir(exist_ok=True)
    days = pd.read_csv(HERE / "data" / "student_days.csv")
    windows = build_windows(days)
    print(f"Built {len(windows)} weekly windows from {days.student_id.nunique()} students "
          f"({windows.at_risk.mean():.1%} at risk)")

    windows, clustering, crosstab = train_clustering(windows)
    print(f"K-means: k={clustering['k']}, silhouette={clustering['silhouette']}, "
          f"ARI vs hidden persona={clustering['adjustedRandIndexVsHiddenPersona']}")
    risk, risk_model, matrix = train_risk(windows)
    for row in risk["comparison"]:
        print(f"  {row['model']:<40} CV F1 {row['cv']['f1']:.3f}  test F1 {row['test']['f1']:.3f}  AUC {row['test']['rocAuc']}")
    print(f"Chosen risk model: {risk['label']} threshold={risk['threshold']} tuned test: {risk['metrics']}")

    # Parity cases so the Node implementation can be checked against Python
    rng = random.Random(SEED)
    sample = windows.iloc[rng.sample(range(len(windows)), 25)]
    X_sample = sample[FEATURE_NAMES].to_numpy()
    probabilities = risk_model.predict_proba(X_sample)[:, 1]
    cluster_scaler_mean = np.array(clustering["mean"])
    cluster_scaler_scale = np.array(clustering["scale"])
    centroids = np.array(clustering["centroids"])
    parity = []
    for (index, row), probability in zip(sample.iterrows(), probabilities):
        point = (row[CLUSTER_FEATURES].to_numpy(dtype=float) - cluster_scaler_mean) / cluster_scaler_scale
        cluster = int(np.argmin(((centroids - point) ** 2).sum(axis=1)))
        parity.append({
            "days": row["_window"], "targets": row["_targets"],
            "features": [float(row[name]) for name in FEATURE_NAMES],
            "dayScores": [score_day(day, row["_targets"])["score"] for day in row["_window"]],
            "cluster": cluster, "riskProbability": round(float(probability), 6),
        })

    dataset = {
        "simulated": True,
        "students": int(days.student_id.nunique()),
        "days": int(days.day.nunique()),
        "studentDays": int(len(days)),
        "loggedDays": int(days.logged.sum()),
        "windows": int(len(windows)),
        "atRiskRate": round(float(windows.at_risk.mean()), 3),
        "description": "Simulated student food diaries (see ml/simulate.py); retrain on real diaries as they accumulate.",
    }
    output = {
        "version": 1,
        "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "featureNames": FEATURE_NAMES,
        "dataset": dataset,
        "clustering": clustering,
        "risk": risk,
        "parity": parity,
    }
    (MODELS / "diet_models.json").write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    report_metrics = {"dataset": dataset,
                      "clustering": {key: value for key, value in clustering.items() if key not in ("centroids", "mean", "scale")},
                      "risk": {key: value for key, value in risk.items() if key not in ("trees", "coef", "mean", "scale")}}
    (REPORTS / "metrics.json").write_text(json.dumps(report_metrics, indent=2), encoding="utf-8")
    write_report(dataset, clustering, crosstab, risk, matrix)
    print("Saved ml/models/diet_models.json and ml/reports/")


def markdown_table(frame):
    header = "| | " + " | ".join(str(column) for column in frame.columns) + " |"
    divider = "| --- |" + " --- |" * len(frame.columns)
    rows = ["| " + str(index) + " | " + " | ".join(str(value) for value in row) + " |" for index, row in frame.iterrows()]
    return "\n".join([header, divider, *rows])


def write_report(dataset, clustering, crosstab, risk, matrix):
    lines = [
        "# Diet monitoring models: training report",
        "",
        f"_Generated {datetime.now().strftime('%d %B %Y %H:%M')} by `ml/train.py`._",
        "",
        "## 1. Data",
        "",
        f"- {dataset['students']} simulated students over {dataset['days']} days "
        f"({dataset['studentDays']:,} student-days, {dataset['loggedDays']:,} with food logged).",
        f"- {dataset['windows']:,} weekly windows (7 days of history + the following 3 days).",
        f"- {dataset['atRiskRate']:.1%} of windows are labelled **at risk** (average diet score below "
        f"{risk['riskScoreThreshold']} over the next {risk['horizonDays']} days).",
        "- Days without any food logged are treated as *not logged*, not as *ate nothing*.",
        "- The data is simulated (see `ml/simulate.py`) because the app does not yet have months of real diaries. "
        "The same pipeline retrains on real diaries once they exist.",
        "",
        "### Features (computed from the last 7 logged days)",
        "",
        "| Feature | Meaning |",
        "| --- | --- |",
        "| energy_ratio_mean / std | Calories eaten / personal energy target (Mifflin-St Jeor x activity factor), average and day-to-day spread |",
        "| protein_ratio_mean | Protein / target (0.8 g per kg body weight) |",
        "| fiber_ratio_mean | Fibre / 25 g (WHO) |",
        "| sugar_ratio_mean | Sugar / limit (10% of energy, WHO) |",
        "| fat_energy_pct_mean | Share of energy from fat (aim under 35%) |",
        "| meals_per_day_mean, breakfast_rate, late_meal_rate | Meal regularity |",
        "| active_minutes_mean | Activity check-ins (aim for 30 minutes a day) |",
        "| score_mean, score_trend | Average daily diet score (0-100) and its slope over the week |",
        "",
        "## 2. Model A: eating-pattern clustering (K-means)",
        "",
        f"- Features: {', '.join(clustering['featureNames'])} (standardised).",
        f"- k searched from 2 to 9; **k = {clustering['k']}** has the best silhouette score "
        f"(**{clustering['silhouette']}**) in the 4-8 range.",
        f"- Adjusted Rand Index against the simulator's hidden habits: **{clustering['adjustedRandIndexVsHiddenPersona']}** "
        "(1 = perfect match, 0 = random). The models never see these hidden labels; this checks the clusters "
        "recover real habits.",
        "",
        "| k | Inertia | Silhouette |",
        "| --- | --- | --- |",
        *[f"| {row['k']} | {row['inertia']:.0f} | {row['silhouette']:.3f} |" for row in clustering["kSearch"]],
        "",
        "| Cluster | Windows | Description |",
        "| --- | --- | --- |",
        *[f"| {c['name']} | {c['size']:,} | {c['description']} |" for c in clustering["clusters"]],
        "",
        "Clusters vs hidden habits (number of windows):",
        "",
        markdown_table(crosstab),
        "",
        "![k selection](kmeans_k_selection.png)",
        "![clusters](clusters_pca.png)",
        "![profiles](cluster_profiles.png)",
        "",
        "## 3. Model B: diet-risk prediction",
        "",
        "Question: *given the last 7 days, will this student's diet score average below "
        f"{risk['riskScoreThreshold']} over the next {risk['horizonDays']} days?*",
        "",
        "- Students are split 75% / 25% so the test set contains **only students the models never saw**.",
        "- Models are compared with 5-fold cross-validation grouped by student on the training students.",
        "",
        "| Model | CV F1 | CV ROC AUC | Test accuracy | Test precision | Test recall | Test F1 | Test ROC AUC |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        *[f"| {row['model']} | {row['cv']['f1']:.3f} ± {row['cvF1Std']:.3f} | {row['cv']['rocAuc']:.3f} | "
          f"{row['test']['accuracy']:.3f} | {row['test']['precision']:.3f} | {row['test']['recall']:.3f} | "
          f"{row['test']['f1']:.3f} | {row['test']['rocAuc']:.3f} |" for row in risk["comparison"]],
        "",
        f"**Chosen model: {risk['label']}** (highest cross-validated F1). It is exported to "
        "`ml/models/diet_models.json` and runs inside the Node server.",
        "",
        f"The alarm threshold was tuned on the training students' out-of-fold predictions: **{risk['threshold']}**. "
        f"At that threshold the test students give accuracy {risk['metrics']['accuracy']:.3f}, precision "
        f"{risk['metrics']['precision']:.3f}, recall {risk['metrics']['recall']:.3f}, F1 {risk['metrics']['f1']:.3f} "
        f"and ROC AUC {risk['metrics']['rocAuc']:.3f}.",
        "",
        f"Confusion matrix on the test students: {int(matrix[1][1])} at-risk windows caught, "
        f"{int(matrix[1][0])} missed, {int(matrix[0][1])} false alarms, {int(matrix[0][0])} correctly OK.",
        "",
        "![comparison](risk_model_comparison.png)",
        "![roc](risk_roc_curves.png)",
        "![confusion](risk_confusion_matrix.png)",
        "![importance](risk_feature_importance.png)",
        "",
        "## 4. Model C: recommendations",
        "",
        "Recommendations are scored live in `diet-model.js`: how well a menu item fills the gap between today's "
        "intake and the student's targets (energy, protein, fibre, fat, sugar), plus a per-student logistic "
        "regression trained on their helpful / not helpful ratings, plus how often students in the same "
        "eating-pattern cluster buy the item.",
        "",
        "## 5. Limitations",
        "",
        "- Nutrition values are estimates from standard food composition tables, not lab analysis of THE KITCHEN's meals.",
        "- The models are trained on simulated diaries; accuracy on real students must be re-measured after retraining.",
        "- The system gives general guidance and is not a medical diagnosis.",
    ]
    (REPORTS / "model_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
