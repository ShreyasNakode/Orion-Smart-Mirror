import asyncio
import os
import sys
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"), override=True)

MODEL = "gemini-2.5-flash-native-audio-latest"
api_key = os.getenv("GEMINI_API_KEY")

print(f"Using API Key: {api_key[:10]}...{api_key[-10:] if api_key else ''}")
client = genai.Client(http_options={"api_version": "v1beta"}, api_key=api_key)

config = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    system_instruction="You are a helpful assistant.",
)

async def test():
    try:
        print("Connecting to live API...")
        async with client.aio.live.connect(model=MODEL, config=config) as session:
            print("Successfully connected!")
            # Send a quick text ping
            print("Sending ping...")
            await session.send_client_content(
                turns=types.Content(role="user", parts=[types.Part(text="Hello! Respond briefly.")]),
                turn_complete=True,
            )
            print("Waiting for response...")
            async for response in session.receive():
                print(f"Received response: {response}")
                if response.server_content and response.server_content.model_turn:
                    for part in response.server_content.model_turn.parts:
                        if part.text:
                            print(f"Model text: {part.text}")
                # Exit after first model turn completes
                if response.server_content and response.server_content.turn_complete:
                    print("Turn complete!")
                    break
    except Exception as e:
        print("Failed to connect or talk to Live API:")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test())
