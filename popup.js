class DRMWatcherPopup {
  constructor() {
    this.isCapturing = false;
    this.data = {};
    this.initializeElements();
    this.bindEvents();
    this.loadData();
    this.setupMessageListener();
  }

  initializeElements() {
    this.toggleCaptureBtn = document.getElementById("toggleCapture");
    this.clearDataBtn = document.getElementById("clearData");
    this.captureIcon = document.getElementById("captureIcon");
    this.captureText = document.getElementById("captureText");

    this.statusDot = document.getElementById("statusDot");
    this.statusText = document.getElementById("statusText");
    this.requestCount = document.getElementById("requestCount");

    this.mpdUrlField = document.getElementById("mpdUrl");
    this.licenseUrlField = document.getElementById("licenseUrl");
    this.mpdHeadersField = document.getElementById("mpdHeaders");
    this.licenseHeadersField = document.getElementById("licenseHeaders");
    this.cookiesField = document.getElementById("cookies");
    this.psshDataField = document.getElementById("psshData");
    this.allDataField = document.getElementById("allData");

    this.copyButtons = document.querySelectorAll(".copy-btn");
  }

  bindEvents() {
    this.toggleCaptureBtn.addEventListener("click", () => {
      if (this.isCapturing) {
        this.stopCapture();
      } else {
        this.startCapture();
      }
    });

    this.clearDataBtn.addEventListener("click", () => {
      this.clearData();
    });

    this.copyButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const target = e.currentTarget.dataset.target;
        this.copyToClipboard(target, btn);
      });
    });

    this.mpdUrlField.addEventListener("input", () => {
      if (this.mpdUrlField.value.trim()) {
        this.extractPSSH();
      }
    });
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "dataUpdated") {
        this.updateData(request.data);
      }
    });
  }

  async loadData() {
    try {
      const response = await chrome.runtime.sendMessage({ action: "getData" });
      if (response.data) {
        this.updateData(response.data);
        this.isCapturing = response.isCapturing;
        this.updateCaptureStatus();
      }
    } catch (error) {
      console.error("Error loading data:", error);
    }
  }

  async startCapture() {
    try {
      await chrome.runtime.sendMessage({ action: "startCapture" });
      this.isCapturing = true;
      this.updateCaptureStatus();
    } catch (error) {
      console.error("Error starting capture:", error);
    }
  }

  async stopCapture() {
    try {
      await chrome.runtime.sendMessage({ action: "stopCapture" });
      this.isCapturing = false;
      this.updateCaptureStatus();
    } catch (error) {
      console.error("Error stopping capture:", error);
    }
  }

  async clearData() {
    try {
      await chrome.runtime.sendMessage({ action: "clearData" });
      this.data = {};
      this.updateUI();
    } catch (error) {
      console.error("Error clearing data:", error);
    }
  }

  async extractPSSH() {
    try {
      await chrome.runtime.sendMessage({ action: "extractPSSH" });
    } catch (error) {
      console.error("Error extracting PSSH:", error);
    }
  }

  updateCaptureStatus() {
    if (this.isCapturing) {
      this.toggleCaptureBtn.classList.add("active");
      this.captureIcon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2"/>';
      this.captureText.textContent = "Stop";
      this.statusDot.classList.add("capturing");
      this.statusText.textContent = "Capturing Traffic";
    } else {
      this.toggleCaptureBtn.classList.remove("active");
      this.captureIcon.innerHTML = '<circle cx="12" cy="12" r="10"/>';
      this.captureText.textContent = "Start";
      this.statusDot.classList.remove("capturing");
      this.statusText.textContent = "Not Capturing";
    }
  }

  updateData(newData) {
    this.data = newData;
    this.updateUI();
  }

  updateUI() {
    this.requestCount.textContent = this.data.requestCount || 0;

    this.mpdUrlField.value = this.data.mpdUrl || "";
    this.licenseUrlField.value = this.data.licenseUrl || "";

    this.mpdHeadersField.value = this.formatHeaders(this.data.mpdHeaders);
    this.licenseHeadersField.value = this.formatHeaders(
      this.data.licenseHeaders
    );

    this.cookiesField.value = this.formatCookies(this.data.cookies);

    this.psshDataField.value = this.data.psshData || "";

    this.allDataField.value = this.formatAllData(this.data);
  }

  formatHeaders(headers) {
    if (!headers || Object.keys(headers).length === 0) {
      return "";
    }

    return Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
  }

  formatCookies(cookies) {
    if (!cookies || Object.keys(cookies).length === 0) {
      return "";
    }

    let formatted = "";
    for (const [domain, cookieList] of Object.entries(cookies)) {
      formatted += `// ${domain}\n`;
      cookieList.forEach((cookie) => {
        formatted += `${cookie.name}=${cookie.value}; `;
      });
      formatted += "\n\n";
    }
    return formatted.trim();
  }

  formatAllData(data) {
    const exportData = {
      mpdUrl: data.mpdUrl || "",
      licenseUrl: data.licenseUrl || "",
      mpdHeaders: data.mpdHeaders || {},
      licenseHeaders: data.licenseHeaders || {},
      cookies: data.cookies || {},
      psshData: data.psshData || "",
      requestCount: data.requestCount || 0,
      capturedAt: new Date().toISOString(),
    };

    return JSON.stringify(exportData, null, 2);
  }

  async copyToClipboard(target, button) {
    try {
      let textToCopy = "";

      switch (target) {
        case "mpdUrl":
          textToCopy = this.mpdUrlField.value;
          break;
        case "licenseUrl":
          textToCopy = this.licenseUrlField.value;
          break;
        case "mpdHeaders":
          textToCopy = this.mpdHeadersField.value;
          break;
        case "licenseHeaders":
          textToCopy = this.licenseHeadersField.value;
          break;
        case "cookies":
          textToCopy = this.cookiesField.value;
          break;
        case "psshData":
          textToCopy = this.psshDataField.value;
          break;
        case "allData":
          textToCopy = this.allDataField.value;
          break;
      }

      if (textToCopy.trim()) {
        await navigator.clipboard.writeText(textToCopy);
        this.showCopySuccess(button);
      } else {
        this.showCopyError(button);
      }
    } catch (error) {
      console.error("Error copying to clipboard:", error);
      this.showCopyError(button);
    }
  }

  showCopySuccess(button) {
    const originalIcon = button.innerHTML;
    button.innerHTML = '<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20,6 9,17 4,12"/></svg>';
    button.classList.add("copied");

    setTimeout(() => {
      button.innerHTML = originalIcon;
      button.classList.remove("copied");
    }, 1000);
  }

  showCopyError(button) {
    const originalIcon = button.innerHTML;
    button.innerHTML = '<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    button.style.color = "var(--accent-danger)";

    setTimeout(() => {
      button.innerHTML = originalIcon;
      button.style.color = "";
    }, 1000);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new DRMWatcherPopup();
});
