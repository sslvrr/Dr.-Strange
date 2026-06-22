"""
Sunday 16:00 ET scheduler for weekly analysis.
Run as an asyncio task at app startup.
"""
import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")


async def learning_scheduler() -> None:
    from learning.analysis import run_weekly_analysis
    print("[learning] scheduler started — fires Sunday 16:00 ET", flush=True)
    last_fired_day: int = -1
    while True:
        await asyncio.sleep(60)
        now = datetime.now(_ET)
        # Sunday=6, fire window: 16:00-16:00 ET (within the first minute)
        if now.weekday() == 6 and now.hour == 16 and now.minute == 0:
            if last_fired_day != now.day:
                last_fired_day = now.day
                print("[learning] Sunday 16:00 ET — starting weekly analysis", flush=True)
                try:
                    await run_weekly_analysis()
                except Exception as e:
                    print(f"[learning] scheduler analysis error: {e}", flush=True)
