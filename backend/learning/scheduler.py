"""
Sunday 21:00 UTC scheduler for weekly analysis.
Run as an asyncio task at app startup.
"""
import asyncio
from datetime import datetime, timezone


async def learning_scheduler() -> None:
    from learning.analysis import run_weekly_analysis
    print("[learning] scheduler started — fires Sunday 21:00 UTC", flush=True)
    last_fired_day: int = -1
    while True:
        await asyncio.sleep(60)
        now = datetime.now(timezone.utc)
        # Sunday=6, fire window: 21:00–21:00 (within the first minute)
        if now.weekday() == 6 and now.hour == 21 and now.minute == 0:
            if last_fired_day != now.day:
                last_fired_day = now.day
                print("[learning] Sunday 21:00 UTC — starting weekly analysis", flush=True)
                try:
                    await run_weekly_analysis()
                except Exception as e:
                    print(f"[learning] scheduler analysis error: {e}", flush=True)
