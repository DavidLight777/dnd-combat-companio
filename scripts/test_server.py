import subprocess, sys, time, requests, os

port = 18765
proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "main:app", "--port", str(port)],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
)
for _ in range(10):
    time.sleep(0.5)
    try:
        r = requests.get(f"http://127.0.0.1:{port}/api/server-info", timeout=2)
        print("status:", r.status_code)
        break
    except Exception as e:
        print("retry...", e)
else:
    print("failed")
    proc.terminate()
    exit(1)

# Try GM page
r2 = requests.get(f"http://127.0.0.1:{port}/gm?code=TEST", timeout=2)
print("gm status:", r2.status_code)
proc.terminate()
proc.wait(timeout=5)
print("done")
