document.addEventListener('DOMContentLoaded', () => {
  const shortCodeDisplay = document.getElementById('shortCodeDisplay');
  const totalClicksElem = document.getElementById('totalClicks');
  const activeHoursElem = document.getElementById('activeHours');
  const chartCanvas = document.getElementById('analyticsChart');
  const chartFallback = document.getElementById('chartFallback');
  const refreshBtn = document.getElementById('refreshBtn');
  const lastUpdated = document.getElementById('lastUpdated');

  // Extract shortCode from path: /analytics/:shortCode
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const shortCode = pathParts[pathParts.length - 1];

  let chartInstance = null;

  if (!shortCode || shortCode === 'analytics') {
    shortCodeDisplay.textContent = 'No short code specified in URL path.';
    return;
  }

  shortCodeDisplay.textContent = `Short Code: ${shortCode}`;

  async function loadAnalytics() {
    try {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Loading...';

      const res = await fetch(`/api/analytics/${shortCode}`);
      if (!res.ok) {
        throw new Error(`Failed to load analytics: ${res.statusText}`);
      }

      const data = await res.json();
      totalClicksElem.textContent = data.total_clicks || 0;
      activeHoursElem.textContent = (data.history || []).length;
      lastUpdated.textContent = `Updated: ${new Date().toLocaleTimeString()}`;

      renderChart(data.history || []);
    } catch (err) {
      console.error(err);
      shortCodeDisplay.textContent = `Error loading analytics: ${err.message}`;
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh Data';
    }
  }

  function renderChart(history) {
    if (!history || history.length === 0) {
      chartCanvas.style.display = 'none';
      chartFallback.style.display = 'block';
      return;
    }

    chartCanvas.style.display = 'block';
    chartFallback.style.display = 'none';

    const labels = history.map(item => {
      const d = new Date(item.hour);
      return `${d.toLocaleDateString()} ${d.getHours()}:00`;
    });
    const values = history.map(item => item.clicks);

    if (chartInstance) {
      chartInstance.destroy();
    }

    if (typeof Chart !== 'undefined') {
      const ctx = chartCanvas.getContext('2d');
      chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Clicks per Hour',
            data: values,
            backgroundColor: 'rgba(56, 189, 248, 0.7)',
            borderColor: '#38bdf8',
            borderWidth: 1,
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                precision: 0,
                color: '#94a3b8'
              },
              grid: {
                color: 'rgba(51, 65, 85, 0.5)'
              }
            },
            x: {
              ticks: {
                color: '#94a3b8'
              },
              grid: {
                display: false
              }
            }
          },
          plugins: {
            legend: {
              labels: {
                color: '#f8fafc'
              }
            }
          }
        }
      });
    }
  }

  refreshBtn.addEventListener('click', loadAnalytics);
  loadAnalytics();
});
