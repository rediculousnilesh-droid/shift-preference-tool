/**
 * Manager page — triggers CSV download of all shift preferences.
 */
(function () {
  'use strict';

  const downloadBtn = document.getElementById('download-btn');
  const messageEl = document.getElementById('download-message');

  let messageTimeout = null;

  function showMessage(text, type) {
    if (messageTimeout) {
      clearTimeout(messageTimeout);
      messageTimeout = null;
    }
    messageEl.textContent = text;
    messageEl.className = 'message ' + (type === 'success' ? 'message-success' : 'message-error');
    messageEl.hidden = false;

    messageTimeout = setTimeout(() => {
      messageEl.hidden = true;
    }, 4000);
  }

  async function handleDownload() {
    downloadBtn.disabled = true;

    try {
      const response = await fetch('/api/export');

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const errorMsg = (body && body.error) || 'Failed to download CSV. Please try again.';
        showMessage(errorMsg, 'error');
        return;
      }

      const blob = await response.blob();

      // Extract filename from Content-Disposition header if available
      const disposition = response.headers.get('Content-Disposition');
      let filename = 'shift_preferences.csv';
      if (disposition) {
        const match = disposition.match(/filename="?([^";\n]+)"?/);
        if (match && match[1]) {
          filename = match[1];
        }
      }

      // Create a temporary link to trigger the download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showMessage('CSV downloaded successfully.', 'success');
    } catch (err) {
      showMessage('Unable to reach the server. Please try again.', 'error');
    } finally {
      downloadBtn.disabled = false;
    }
  }

  downloadBtn.addEventListener('click', handleDownload);
})();
