document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('shortenForm');
  const urlInput = document.getElementById('urlInput');
  const strategySelect = document.getElementById('strategySelect');
  const expiresSelect = document.getElementById('expiresSelect');
  const shortenBtn = document.getElementById('shortenBtn');
  const resultDisplay = document.getElementById('resultDisplay');
  const formError = document.getElementById('formError');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.style.display = 'none';
    formError.textContent = '';

    const url = urlInput.value.trim();
    const strategy = strategySelect.value;
    const expiresOption = expiresSelect.value;

    if (!url) {
      formError.textContent = 'Please enter a valid URL.';
      formError.style.display = 'block';
      return;
    }

    let expires_at = null;
    if (expiresOption) {
      const now = new Date();
      if (expiresOption === '1h') now.setHours(now.getHours() + 1);
      else if (expiresOption === '24h') now.setHours(now.getHours() + 24);
      else if (expiresOption === '7d') now.setDate(now.getDate() + 7);
      else if (expiresOption === '30d') now.setDate(now.getDate() + 30);
      expires_at = now.toISOString();
    }

    shortenBtn.disabled = true;
    shortenBtn.textContent = 'Generating...';

    try {
      const payload = { url, strategy };
      if (expires_at) {
        payload.expires_at = expires_at;
      }

      const response = await fetch('/api/shorten', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to shorten URL');
      }

      const shortUrl = data.short_url;
      const shortCode = data.short_code || shortUrl.split('/').pop();

      // Ensure data-testid="result-display" contains the returned short URL
      resultDisplay.innerHTML = `
        <div class="result-box">
          <div style="margin-bottom: 0.5rem; color: var(--text-muted); font-size: 0.8125rem;">Shortened URL:</div>
          <a href="${shortUrl}" target="_blank" rel="noopener noreferrer" class="result-link" id="createdShortUrl">${shortUrl}</a>
          <div class="result-meta">
            <span class="badge">Strategy: ${data.strategy}</span>
            <button type="button" class="copy-btn" id="copyBtn">Copy</button>
            <a href="/analytics/${shortCode}" class="analytics-link-btn" target="_blank">View Analytics &rarr;</a>
          </div>
        </div>
      `;

      const copyBtn = document.getElementById('copyBtn');
      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(shortUrl);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
          } catch (err) {
            console.error('Clipboard copy failed:', err);
          }
        });
      }
    } catch (err) {
      formError.textContent = err.message || 'An unexpected error occurred.';
      formError.style.display = 'block';
    } finally {
      shortenBtn.disabled = false;
      shortenBtn.textContent = 'Shorten URL';
    }
  });
});
