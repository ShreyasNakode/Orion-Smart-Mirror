import asyncio
import os
import sys

from web_agent import WebAgent, WEB_AGENT_MODEL_CANDIDATES, PROFILE_DIR

async def main():
    print("[VERIFY] Checking WebAgent configuration...")
    print(f"[VERIFY] Model candidates: {WEB_AGENT_MODEL_CANDIDATES}")
    assert "gemini-2.5-flash" not in WEB_AGENT_MODEL_CANDIDATES, "gemini-2.5-flash should not be in computer use candidates"

    print(f"[VERIFY] Persistent Browser Profile Dir: {PROFILE_DIR}")

    agent = WebAgent()
    print("[VERIFY] Initializing Playwright persistent browser...")
    await agent.init_browser()

    assert agent.page is not None, "Playwright page must be initialized"
    print(f"[VERIFY] Page URL: {agent.page.url}")

    # Test manual click & typing execution
    print("[VERIFY] Testing manual click & typing execution...")
    await agent.execute_manual_action({"action": "click", "x": 500, "y": 500})
    await agent.execute_manual_action({"action": "type", "text": "Orion Smart Mirror Test"})
    await agent.execute_manual_action({"action": "key", "key": "Enter"})

    print("[VERIFY SUCCESS] Manual touch/keyboard actions executed cleanly on Playwright!")

    if agent.context:
        await agent.context.close()
    if agent.playwright:
        await agent.playwright.stop()

if __name__ == "__main__":
    asyncio.run(main())
