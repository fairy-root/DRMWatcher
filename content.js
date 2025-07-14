(function () {
  "use strict";

  class DRMContentWatcher {
    constructor() {
      this.originalFetch = window.fetch;
      this.originalXMLHttpRequest = window.XMLHttpRequest;
      this.initializeWatchers();
    }

    initializeWatchers() {
      this.interceptFetch();
      this.interceptXMLHttpRequest();
      this.watchForMediaElements();
      this.injectDRMDetector();
    }

    interceptFetch() {
      const self = this;
      window.fetch = function (...args) {
        const [url, options] = args;

        if (self.isDRMRelated(url)) {
          self.logDRMRequest("fetch", url, options);
        }

        return self.originalFetch.apply(this, args).then((response) => {
          if (self.isDRMRelated(url)) {
            self.handleDRMResponse(url, response.clone());
          }
          return response;
        });
      };
    }

    interceptXMLHttpRequest() {
      const self = this;
      const OriginalXHR = window.XMLHttpRequest;

      window.XMLHttpRequest = function () {
        const xhr = new OriginalXHR();
        const originalOpen = xhr.open;
        const originalSend = xhr.send;

        xhr.open = function (method, url, ...args) {
          this._url = url;
          this._method = method;
          return originalOpen.apply(this, [method, url, ...args]);
        };

        xhr.send = function (data) {
          if (self.isDRMRelated(this._url)) {
            self.logDRMRequest("xhr", this._url, {
              method: this._method,
              data,
            });
          }
          return originalSend.apply(this, arguments);
        };

        return xhr;
      };
    }

    watchForMediaElements() {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              const mediaElements = node.querySelectorAll
                ? node.querySelectorAll("video, audio")
                : [];

              if (node.tagName === "VIDEO" || node.tagName === "AUDIO") {
                this.watchMediaElement(node);
              }

              mediaElements.forEach((element) => {
                this.watchMediaElement(element);
              });
            }
          });
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    watchMediaElement(element) {
      element.addEventListener("encrypted", (event) => {
        this.handleEncryptedEvent(event);
      });

      element.addEventListener("loadstart", () => {
        if (element.src && this.isDRMRelated(element.src)) {
          this.logMediaSource(element.src);
        }
      });
    }

    handleEncryptedEvent(event) {
      const data = {
        initDataType: event.initDataType,
        initData: this.arrayBufferToBase64(event.initData),
        timestamp: Date.now(),
      };

      chrome.runtime
        .sendMessage({
          action: "encryptedEvent",
          data: data,
        })
        .catch(() => {});
    }

    injectDRMDetector() {
      const script = document.createElement("script");
      script.textContent = `
                (function() {
                    
                    if (window.navigator.requestMediaKeySystemAccess) {
                        const original = window.navigator.requestMediaKeySystemAccess;
                        window.navigator.requestMediaKeySystemAccess = function(keySystem, configs) {
                            console.log('DRM System Requested:', keySystem, configs);
                            window.postMessage({
                                type: 'DRM_SYSTEM_REQUEST',
                                keySystem: keySystem,
                                configs: configs
                            }, '*');
                            return original.apply(this, arguments);
                        };
                    }
                    
                    
                    if (window.MediaKeySession) {
                        const originalGenerateRequest = MediaKeySession.prototype.generateRequest;
                        MediaKeySession.prototype.generateRequest = function(initDataType, initData) {
                            console.log('License Request Generated:', initDataType, initData);
                            window.postMessage({
                                type: 'LICENSE_REQUEST_GENERATED',
                                initDataType: initDataType,
                                initData: Array.from(new Uint8Array(initData))
                            }, '*');
                            return originalGenerateRequest.apply(this, arguments);
                        };
                    }
                })();
            `;

      document.head.appendChild(script);
      document.head.removeChild(script);

      window.addEventListener("message", (event) => {
        if (
          event.data.type === "DRM_SYSTEM_REQUEST" ||
          event.data.type === "LICENSE_REQUEST_GENERATED"
        ) {
          this.handleDRMEvent(event.data);
        }
      });
    }

    isDRMRelated(url) {
      if (!url) return false;
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
      ];
      return drmKeywords.some((keyword) => urlLower.includes(keyword));
    }

    logDRMRequest(type, url, options) {
      const requestData = {
        type: type,
        url: url,
        options: options,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
      };

      chrome.runtime
        .sendMessage({
          action: "drmRequestDetected",
          data: requestData,
        })
        .catch(() => {});
    }

    async handleDRMResponse(url, response) {
      try {
        const text = await response.text();

        if (text.includes("cenc:pssh") || text.includes("pssh")) {
          chrome.runtime
            .sendMessage({
              action: "psshDetected",
              data: {
                url: url,
                content: text,
                timestamp: Date.now(),
              },
            })
            .catch(() => {});
        }
      } catch (error) {
        console.error("Error handling DRM response:", error);
      }
    }

    logMediaSource(src) {
      chrome.runtime
        .sendMessage({
          action: "mediaSourceDetected",
          data: {
            src: src,
            timestamp: Date.now(),
          },
        })
        .catch(() => {});
    }

    handleDRMEvent(eventData) {
      chrome.runtime
        .sendMessage({
          action: "drmEventDetected",
          data: eventData,
        })
        .catch(() => {});
    }

    arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      new DRMContentWatcher();
    });
  } else {
    new DRMContentWatcher();
  }
})();
