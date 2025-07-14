class DRMWatcher {
  constructor() {
    this.isCapturing = false;
    this.capturedData = {
      mpdUrl: "",
      licenseUrl: "",
      mpdHeaders: {},
      licenseHeaders: {},
      cookies: {},
      psshData: "",
      allRequests: [],
      requestCount: 0,
    };
    this.initializeListeners();
  }

  initializeListeners() {
    chrome.webRequest.onBeforeRequest.addListener(
      this.handleBeforeRequest.bind(this),
      { urls: ["<all_urls>"] },
      ["requestBody"]
    );

    chrome.webRequest.onBeforeSendHeaders.addListener(
      this.handleBeforeSendHeaders.bind(this),
      { urls: ["<all_urls>"] },
      ["requestHeaders", "extraHeaders"]
    );

    chrome.webRequest.onHeadersReceived.addListener(
      this.handleHeadersReceived.bind(this),
      { urls: ["<all_urls>"] },
      ["responseHeaders", "extraHeaders"]
    );

    chrome.webRequest.onCompleted.addListener(
      this.handleCompleted.bind(this),
      { urls: ["<all_urls>"] },
      ["responseHeaders"]
    );

    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));

    this.loadStoredData();
  }

  async loadStoredData() {
    try {
      const result = await chrome.storage.local.get(["drmWatcherData"]);
      if (result.drmWatcherData) {
        this.capturedData = { ...this.capturedData, ...result.drmWatcherData };
      }
    } catch (error) {
      console.error("Error loading stored data:", error);
    }
  }

  async saveData() {
    try {
      await chrome.storage.local.set({ drmWatcherData: this.capturedData });
    } catch (error) {
      console.error("Error saving data:", error);
    }
  }

  handleBeforeRequest(details) {
    if (!this.isCapturing) return;

    const url = details.url.toLowerCase();
    const method = details.method;

    if (url.includes(".mpd") || url.includes("manifest")) {
      if (!this.capturedData.mpdUrl) {
        this.capturedData.mpdUrl = details.url;
        console.log("MPD URL captured:", details.url);
        this.saveData();
        this.notifyUpdate();
      }
    }

    if (this.isLicenseRequest(url, method, details)) {
      if (!this.capturedData.licenseUrl) {
        this.capturedData.licenseUrl = details.url;
        console.log("License URL captured:", details.url);
        this.saveData();
        this.notifyUpdate();
      }
    }

    this.capturedData.allRequests.push({
      url: details.url,
      method: method,
      timestamp: Date.now(),
      type: this.getRequestType(url, method),
    });

    this.capturedData.requestCount++;
    this.saveData();
  }

  handleBeforeSendHeaders(details) {
    if (!this.isCapturing) return;

    const url = details.url.toLowerCase();
    const headers = this.extractHeaders(details.requestHeaders);

    if (url.includes(".mpd") || url.includes("manifest")) {
      this.capturedData.mpdHeaders = headers;
      this.captureCookies(details.url);
    }

    if (this.isLicenseRequest(url, details.method, details)) {
      this.capturedData.licenseHeaders = headers;
      this.captureCookies(details.url);
    }

    this.saveData();
    this.notifyUpdate();
  }

  handleHeadersReceived(details) {
    if (!this.isCapturing) return;
  }

  async handleCompleted(details) {
    if (!this.isCapturing) return;

    const url = details.url.toLowerCase();

    if (
      (url.includes(".mpd") || url.includes("manifest")) &&
      details.statusCode === 200
    ) {
      this.extractPSSHFromResponse(details.url);
    }
  }

  async captureCookies(url) {
    try {
      const urlObj = new URL(url);
      const cookies = await chrome.cookies.getAll({ domain: urlObj.hostname });

      if (cookies.length > 0) {
        this.capturedData.cookies[urlObj.hostname] = cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
        }));
        this.saveData();
        this.notifyUpdate();
      }
    } catch (error) {
      console.error("Error capturing cookies:", error);
    }
  }

  isLicenseRequest(url, method, details) {
    const licenseKeywords = [
      "license",
      "widevine",
      "playready",
      "fairplay",
      "cenc",
    ];
    const urlLower = url.toLowerCase();
    const urlContainsKeyword = licenseKeywords.some((keyword) =>
      urlLower.includes(keyword)
    );

    const isPostRequest = method === "POST";

    let bodyContainsDRM = false;
    if (details.requestBody && details.requestBody.raw) {
      const bodyText = this.arrayBufferToString(
        details.requestBody.raw[0].bytes
      );
      const bodyLower = bodyText.toLowerCase();
      bodyContainsDRM = licenseKeywords.some((keyword) =>
        bodyLower.includes(keyword)
      );
    }

    let hasLicenseContentType = false;
    if (details.requestHeaders) {
      const contentType = details.requestHeaders.find(
        (h) => h.name.toLowerCase() === "content-type"
      );
      if (
        contentType &&
        contentType.value.includes("application/octet-stream")
      ) {
        hasLicenseContentType = true;
      }
    }

    return (
      (urlContainsKeyword && (isPostRequest || method === "GET")) ||
      (bodyContainsDRM && isPostRequest) ||
      (hasLicenseContentType && isPostRequest && url.length > 50)
    );
  }

  getRequestType(url, method) {
    if (url.includes(".mpd") || url.includes("manifest")) return "MPD";
    if (this.isLicenseRequest(url, method, {})) return "LICENSE";
    if (url.includes(".m3u8")) return "HLS";
    return "OTHER";
  }

  extractHeaders(requestHeaders) {
    const headers = {};
    if (requestHeaders) {
      requestHeaders.forEach((header) => {
        headers[header.name] = header.value;
      });
    }
    return headers;
  }

  arrayBufferToString(buffer) {
    try {
      return new TextDecoder().decode(buffer);
    } catch (error) {
      return "";
    }
  }

  async fetchPSSHFromMPD(mpdUrl) {
    try {
      const response = await fetch(mpdUrl);
      const mpdContent = await response.text();

      this.extractPSSHFromContent(mpdContent);
    } catch (error) {
      console.error("Error fetching PSSH from MPD:", error);
    }
  }

  async extractPSSHFromResponse(mpdUrl) {
    try {
      const response = await fetch(mpdUrl);
      const mpdContent = await response.text();

      this.extractPSSHFromContent(mpdContent);
    } catch (error) {
      console.error("Error extracting PSSH from response:", error);
    }
  }

  extractPSSHFromContent(mpdContent) {
    try {
      const psshPatterns = [
        /<cenc:pssh[^>]*>([^<]+)<\/cenc:pssh>/gi,
        /<pssh[^>]*>([^<]+)<\/pssh>/gi,
        /pssh="([^"]+)"/gi,
        /"pssh":"([^"]+)"/gi,
      ];

      let allPssh = [];

      psshPatterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(mpdContent)) !== null) {
          const psshData = match[1].trim();
          if (psshData && !allPssh.includes(psshData)) {
            allPssh.push(psshData);
          }
        }
      });

      if (allPssh.length > 0) {
        this.capturedData.psshData = allPssh.join("\n\n");
        this.saveData();
        this.notifyUpdate();
        console.log("PSSH extracted:", allPssh);
      }
    } catch (error) {
      console.error("Error extracting PSSH from content:", error);
    }
  }

  handleMessage(request, sender, sendResponse) {
    switch (request.action) {
      case "startCapture":
        this.startCapture();
        sendResponse({ success: true });
        break;

      case "stopCapture":
        this.stopCapture();
        sendResponse({ success: true });
        break;

      case "getData":
        sendResponse({
          data: this.capturedData,
          isCapturing: this.isCapturing,
        });
        break;

      case "clearData":
        this.clearData();
        sendResponse({ success: true });
        break;

      case "extractPSSH":
        if (this.capturedData.mpdUrl) {
          this.fetchPSSHFromMPD(this.capturedData.mpdUrl);
        }
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ error: "Unknown action" });
    }
  }

  startCapture() {
    this.isCapturing = true;
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#4CAF50" });
    console.log("DRM Watcher: Started capturing");
  }

  stopCapture() {
    this.isCapturing = false;
    chrome.action.setBadgeText({ text: "" });
    console.log("DRM Watcher: Stopped capturing");
  }

  clearData() {
    this.capturedData = {
      mpdUrl: "",
      licenseUrl: "",
      mpdHeaders: {},
      licenseHeaders: {},
      cookies: {},
      psshData: "",
      allRequests: [],
      requestCount: 0,
    };
    this.saveData();
    this.notifyUpdate();
    console.log("DRM Watcher: Cleared all data");
  }

  notifyUpdate() {
    chrome.runtime
      .sendMessage({
        action: "dataUpdated",
        data: this.capturedData,
      })
      .catch(() => {});
  }
}

const drmWatcher = new DRMWatcher();

chrome.runtime.onInstalled.addListener(() => {
  console.log("DRM Watcher extension installed");
  chrome.action.setBadgeText({ text: "" });
});
