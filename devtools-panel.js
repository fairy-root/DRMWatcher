class DRMDevToolsPanel {
  constructor() {
    this.requests = [];
    this.initializeElements();
    this.bindEvents();
    this.startNetworkMonitoring();
  }

  initializeElements() {
    this.requestsList = document.getElementById("requestsList");
    this.clearBtn = document.getElementById("clearRequests");
    this.exportBtn = document.getElementById("exportRequests");
  }

  bindEvents() {
    this.clearBtn.addEventListener("click", () => {
      this.clearRequests();
    });

    this.exportBtn.addEventListener("click", () => {
      this.exportRequests();
    });
  }

  startNetworkMonitoring() {
    chrome.devtools.network.onRequestFinished.addListener((request) => {
      if (this.isDRMRelated(request.request.url)) {
        this.addRequest(request);
      }
    });
  }

  isDRMRelated(url) {
    const urlLower = url.toLowerCase();
    const drmKeywords = [
      ".mpd",
      "manifest",
      "license",
      "widevine",
      "playready",
      "fairplay",
      "cenc",
      "drm",
      ".m3u8",
      "lic",
    ];
    return drmKeywords.some((keyword) => urlLower.includes(keyword));
  }

  addRequest(request) {
    const requestData = {
      url: request.request.url,
      method: request.request.method,
      status: request.response.status,
      statusText: request.response.statusText,
      headers: request.request.headers,
      responseHeaders: request.response.headers,
      timestamp: Date.now(),
      type: this.getRequestType(request.request.url),
    };

    this.requests.unshift(requestData);

    if (this.requests.length > 100) {
      this.requests = this.requests.slice(0, 100);
    }

    this.updateUI();

    chrome.runtime
      .sendMessage({
        action: "devtoolsRequest",
        data: requestData,
      })
      .catch(() => {});
  }

  getRequestType(url) {
    const urlLower = url.toLowerCase();
    if (urlLower.includes(".mpd") || urlLower.includes("manifest"))
      return "MPD";
    if (
      urlLower.includes("license") ||
      urlLower.includes("widevine") ||
      urlLower.includes("playready") ||
      urlLower.includes("lic")
    )
      return "LICENSE";
    if (urlLower.includes(".m3u8")) return "HLS";
    return "OTHER";
  }

  updateUI() {
    if (this.requests.length === 0) {
      this.requestsList.innerHTML = `
                <p style="color: var(--text-secondary); text-align: center; padding: 20px;">
                    No DRM-related requests captured yet. Start browsing to see network activity.
                </p>
            `;
      return;
    }

    const requestsHTML = this.requests
      .map((request) => {
        const timestamp = new Date(request.timestamp).toLocaleTimeString();
        const statusColor =
          request.status >= 200 && request.status < 300 ? "#4CAF50" : "#f44336";

        return `
                <div class="network-request">
                    <div class="request-url">
                        <strong>[${request.type}]</strong> ${request.method} ${
          request.url
        }
                    </div>
                    <div class="request-details">
                        <span style="color: ${statusColor};">${
          request.status
        } ${request.statusText}</span> | 
                        ${timestamp} | 
                        Headers: ${Object.keys(request.headers).length}
                    </div>
                </div>
            `;
      })
      .join("");

    this.requestsList.innerHTML = requestsHTML;
  }

  clearRequests() {
    this.requests = [];
    this.updateUI();
  }

  exportRequests() {
    const exportData = {
      requests: this.requests,
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `drm-requests-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new DRMDevToolsPanel();
});
