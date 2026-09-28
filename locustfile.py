import random
import time
from locust import HttpUser, task, between

class URLShortenerUser(HttpUser):
    wait_time = between(0.01, 0.05)
    created_codes = []

    def on_start(self):
        # Warmup: create a few links to populate redirect pool
        for _ in range(5):
            url = f"https://example.com/warmup/{random.randint(1000, 999999)}"
            strategy = random.choice(["hash", "snowflake"])
            res = self.client.post("/api/shorten", json={"url": url, "strategy": strategy})
            if res.status_code == 201:
                data = res.json()
                code = data.get("short_code") or data.get("short_url", "").split("/")[-1]
                if code:
                    self.created_codes.append(code)

    @task(3)
    def shorten_hash(self):
        url = f"https://example.com/page/{random.randint(10000, 9999999)}/{time.time()}"
        res = self.client.post(
            "/api/shorten",
            json={"url": url, "strategy": "hash"},
            name="/api/shorten [hash]"
        )
        if res.status_code == 201:
            data = res.json()
            code = data.get("short_code") or data.get("short_url", "").split("/")[-1]
            if code and len(self.created_codes) < 200:
                self.created_codes.append(code)

    @task(3)
    def shorten_snowflake(self):
        url = f"https://example.com/article/{random.randint(10000, 9999999)}/{time.time()}"
        res = self.client.post(
            "/api/shorten",
            json={"url": url, "strategy": "snowflake"},
            name="/api/shorten [snowflake]"
        )
        if res.status_code == 201:
            data = res.json()
            code = data.get("short_code") or data.get("short_url", "").split("/")[-1]
            if code and len(self.created_codes) < 200:
                self.created_codes.append(code)

    @task(10)
    def redirect_short_url(self):
        if not self.created_codes:
            return
        code = random.choice(self.created_codes)
        # allow_redirects=False to inspect 302 and X-Cache-Status
        with self.client.get(f"/{code}", allow_redirects=False, catch_response=True, name="/:shortCode [redirect]") as response:
            if response.status_code == 302:
                response.success()
            else:
                response.failure(f"Expected 302, got {response.status_code}")

    @task(1)
    def get_analytics(self):
        if not self.created_codes:
            return
        code = random.choice(self.created_codes)
        self.client.get(f"/api/analytics/{code}", name="/api/analytics/:shortCode")
