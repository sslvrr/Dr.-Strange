"""
Weekly statistical analysis engine for Dr. Strange.
Reads resolved outcomes from SQLite, generates confidence multipliers,
writes recommendations.json.
"""
import json
import os
import time
from typing import Any, Dict, List, Optional

import numpy as np

from learning.db import get_all_resolved, save_weekly_review

_HERE = os.path.dirname(os.path.abspath(__file__))
RECS_PATH = os.path.join(_HERE, "recommendations.json")

_MIN_OUTCOMES   = 30
_MULTIPLIER_MIN = 0.6
_MULTIPLIER_MAX = 1.4


def _is_win(outcome: str) -> bool:
    return outcome in ("TP1_WIN", "TP2_WIN")


def _clamp(v: float) -> float:
    return max(_MULTIPLIER_MIN, min(_MULTIPLIER_MAX, v))


def _feature_insights(rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Flag features where winners differ meaningfully from losers."""
    features = ["atr", "cvd", "ofi", "z_score"]
    insights = []
    wins   = [r for r in rows if _is_win(r["outcome"])]
    losses = [r for r in rows if not _is_win(r["outcome"])]
    if len(wins) < 5 or len(losses) < 5:
        return []
    for feat in features:
        wv = [r[feat] for r in wins  if r.get(feat) is not None]
        lv = [r[feat] for r in losses if r.get(feat) is not None]
        if len(wv) < 3 or len(lv) < 3:
            continue
        w_med = float(np.median(wv))
        l_med = float(np.median(lv))
        pooled_std = float(np.std(wv + lv)) or 1e-10
        delta = abs(w_med - l_med) / pooled_std
        if delta > 0.3:
            direction = "higher" if w_med > l_med else "lower"
            insights.append({
                "feature": feat,
                "note": f"winners show {direction} {feat} (Δ={delta:.2f}σ)",
            })
    return insights


async def run_weekly_analysis() -> Dict[str, Any]:
    """Full analysis cycle. Returns result dict."""
    rows = await get_all_resolved()
    n = len(rows)

    if n < _MIN_OUTCOMES:
        result = {"status": "insufficient_data", "samples": n}
        with open(RECS_PATH, "w") as f:
            json.dump(result, f)
        print(f"[learning] analysis: only {n}/{_MIN_OUTCOMES} samples — skipped", flush=True)
        return result

    # Overall win rate baseline
    wins_total = sum(1 for r in rows if _is_win(r["outcome"]))
    baseline_wr = wins_total / n

    # Per (symbol, regime-proxy) breakdown
    groups: Dict[str, List] = {}
    for r in rows:
        key = f"{r['symbol']}|{r['direction']}"  # direction as simple regime proxy
        groups.setdefault(key, []).append(r)

    adjustments = []
    for key, group in groups.items():
        symbol, direction = key.split("|")
        if len(group) < 5:
            continue
        wr = sum(1 for r in group if _is_win(r["outcome"])) / len(group)
        multiplier = _clamp(wr / max(baseline_wr, 0.01))
        if abs(multiplier - 1.0) > 0.05:  # only emit meaningful adjustments
            adjustments.append({
                "symbol":     symbol,
                "regime":     direction,
                "multiplier": round(multiplier, 3),
                "sample_n":   len(group),
                "win_rate":   round(wr * 100, 1),
            })

    insights = _feature_insights(rows)

    summary_parts = [f"{n} trades reviewed."]
    if adjustments:
        up   = [a for a in adjustments if a["multiplier"] > 1.0]
        down = [a for a in adjustments if a["multiplier"] < 1.0]
        if up:
            summary_parts.append(f"{len(up)} edge(s) detected (↑).")
        if down:
            summary_parts.append(f"{len(down)} underperformer(s) (↓).")
    else:
        summary_parts.append("No significant adjustments needed.")
    if insights:
        summary_parts.append(f"Key feature: {insights[0]['note']}.")
    summary = " ".join(summary_parts)

    result = {
        "generated_at":    int(time.time()),
        "samples_used":    n,
        "adjustments":     adjustments,
        "feature_insights": insights,
        "summary":         summary,
        "status":          "ok",
    }

    with open(RECS_PATH, "w") as f:
        json.dump(result, f, indent=2)

    await save_weekly_review(n, adjustments, summary)

    print(f"[learning] analysis complete — {n} samples, {len(adjustments)} adjustments", flush=True)
    return result
