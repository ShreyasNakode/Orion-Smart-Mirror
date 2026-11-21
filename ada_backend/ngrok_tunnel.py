"""
Orion Smart Mirror â€” Secure Ngrok Tunnel Utility
Exposes the FastAPI skin inference server (port 8001) over HTTPS.
"""
import os
import sys
import json
import time

def start_ngrok_tunnel(port=int(os.getenv("PORT", 8001)), auth_token=None):
    auth_token = auth_token or os.getenv("NGROK_AUTHTOKEN")
    
    try:
        from pyngrok import ngrok, conf
        if auth_token:
            ngrok.set_auth_token(auth_token)
            print("[NGROK] Auth token configured.", file=sys.stderr)
        
        print(f"[NGROK] Opening HTTPS tunnel to http://localhost:{port}...", file=sys.stderr)
        tunnel = ngrok.connect(port, "http")
        public_url = tunnel.public_url
        if public_url.startswith("http://"):
            public_url = public_url.replace("http://", "https://")
            
        print(f"\n=======================================================", file=sys.stderr)
        print(f"[NGROK SUCCESS] Public API Endpoint: {public_url}", file=sys.stderr)
        print(f"[NGROK SUCCESS] Predict Endpoint:    {public_url}/predict", file=sys.stderr)
        print(f"=======================================================\n", file=sys.stderr)
        
        # Save to ngrok_url.json so server.ts / frontend can read it dynamically
        url_file = os.path.join(os.path.dirname(__file__), "ngrok_url.json")
        with open(url_file, "w") as f:
            json.dump({
                "public_url": public_url,
                "predict_endpoint": f"{public_url}/predict",
                "timestamp": int(time.time())
            }, f, indent=2)
            
        return public_url, tunnel
    except Exception as e:
        print(f"[NGROK ERROR] Could not start pyngrok tunnel: {e}", file=sys.stderr)
        print("[NGROK TIP] Install pyngrok via `pip install pyngrok` or run `ngrok http 8001` directly.", file=sys.stderr)
        return None, None

if __name__ == "__main__":
    token = sys.argv[1] if len(sys.argv) > 1 else None
    url, _ = start_ngrok_tunnel(int(os.getenv("PORT", 8001)), token)
    if url:
        print(json.dumps({"url": url, "predict": f"{url}/predict"}))
        # Keep process alive if called standalone
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[NGROK] Tunnel closed.", file=sys.stderr)

