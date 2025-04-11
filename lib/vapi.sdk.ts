import Vapi from "@vapi-ai/web";

// Add type declaration for the global Vapi instance
declare global {
  interface Window {
    __VAPI_INSTANCE__?: any;
    __VAPI_DAILY_ERROR_HANDLER__?: (error: any) => boolean;
  }
}

let vapi: any;

const vapiConfig = {
  debug: process.env.NODE_ENV === "development",
  timeout: 3000,
  retries: 1,
};

// Fallback Vapi mock to avoid crashes
const createMockVapi = () => ({
  on: () => {},
  off: () => {},
  start: () => Promise.resolve(),
  stop: () => {},
  setDebug: () => {},
  setTimeout: () => {},
});

const createVapiWrapper = (vapiInstance: any) =>
  new Proxy(vapiInstance, {
    get: (target, prop) => {
      if (typeof target[prop] === "function") {
        return (...args: any[]) => {
          try {
            if (prop === "start") {
              const startPromise = target[prop](...args);
              const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                  reject(new Error("Vapi start method timed out after 10 seconds"));
                }, 10000);
              });

              return Promise.race([startPromise, timeoutPromise]).catch((error) => {
                console.error("Error in Vapi start method:", error);
                if (error instanceof Error) {
                  console.error("Message:", error.message);
                  console.error("Stack:", error.stack);
                } else {
                  console.error("Non-standard error:", JSON.stringify(error, null, 2));
                }

                try {
                  target.stop();
                } catch (cleanupError) {
                  console.error("Error during cleanup:", cleanupError);
                }

                throw error;
              });
            }

            const result = target[prop](...args);
            if (result && typeof result.then === "function") {
              return result.catch((error: any) => {
                console.error(`Error in Vapi method ${String(prop)}:`, error);
                if (
                  error?.message?.includes("Meeting has ended") ||
                  error?.message?.includes("Meeting ended")
                ) {
                  console.log("Meeting ended, handling gracefully");
                  if (typeof document !== "undefined") {
                    const notification = document.createElement("div");
                    notification.style.cssText =
                      "position:fixed;top:0;left:0;right:0;background:#f44336;color:white;padding:10px;text-align:center;z-index:9999";
                    notification.textContent =
                      "The interview session has ended. Your responses have been saved. Please refresh the page to start a new session.";
                    document.body.appendChild(notification);
                    setTimeout(() => notification.remove(), 5000);
                  }
                  return Promise.resolve();
                }

                throw error;
              });
            }

            return result;
          } catch (error) {
            console.error(`Error in Vapi method ${String(prop)}:`, error);
            throw error;
          }
        };
      }

      return target[prop];
    },
  });

if (typeof window !== "undefined") {
  if (!window.__VAPI_DAILY_ERROR_HANDLER__) {
    window.__VAPI_DAILY_ERROR_HANDLER__ = (error: any) => {
      const message = error?.message || "";
      if (message.includes("Meeting has ended") || message.includes("Meeting ended")) {
        console.log("Daily.co meeting ended error detected, cleaning up resources");
        try {
          if (window.__VAPI_INSTANCE__) {
            window.__VAPI_INSTANCE__.stop();
            window.dispatchEvent(
              new CustomEvent("vapi:meeting-ended", { detail: { error } })
            );
          }
        } catch (cleanupError) {
          console.error("Error during Daily.co cleanup:", cleanupError);
        }
        return true;
      }
      return false;
    };
  }

  const originalConsoleError = console.error;
  console.error = function (...args) {
    originalConsoleError.apply(console, args);
    const errorMessage = args.join(" ");
    if (errorMessage.includes("Meeting has ended") || errorMessage.includes("Meeting ended")) {
      window.__VAPI_DAILY_ERROR_HANDLER__?.({ message: errorMessage });
    }
  };

  window.addEventListener("unhandledrejection", (event) => {
    if (window.__VAPI_DAILY_ERROR_HANDLER__?.(event.reason)) {
      console.log("Caught unhandled rejection for Meeting ended error");
      event.preventDefault();
    }
  });

  window.addEventListener("error", (event) => {
    if (window.__VAPI_DAILY_ERROR_HANDLER__?.(event.error)) {
      console.log("Caught global error for Meeting ended error");
      event.preventDefault();
    }
  });

  try {
    const createNewVapiInstance = () => {
      const token = process.env.NEXT_PUBLIC_VAPI_WEB_TOKEN;
      if (!token) {
        console.error("Missing Vapi token. Please check .env settings.");
        return createMockVapi();
      }

      console.log("Creating new Vapi instance");
      const instance = new Vapi(token);
      const wrapped = createVapiWrapper(instance);
      window.__VAPI_INSTANCE__ = wrapped;
      return wrapped;
    };

    if (!window.__VAPI_INSTANCE__) {
      vapi = createNewVapiInstance();
    } else {
      try {
        if (typeof window.__VAPI_INSTANCE__.on === "function") {
          console.log("Using existing Vapi instance");
          vapi = window.__VAPI_INSTANCE__;
        } else {
          console.warn("Invalid Vapi instance, creating a new one");
          vapi = createNewVapiInstance();
        }
      } catch {
        console.warn("Error accessing Vapi instance, creating new one");
        vapi = createNewVapiInstance();
      }
    }

    window.addEventListener("vapi:meeting-ended", () => {
      console.log("Meeting ended event received, resetting Vapi instance");
      setTimeout(() => {
        window.__VAPI_INSTANCE__ = undefined;
      }, 1000);
    });

    if (vapi.setDebug && vapiConfig.debug) vapi.setDebug(vapiConfig.debug);
    if (vapi.setTimeout) vapi.setTimeout(vapiConfig.timeout);

    if (
      navigator?.mediaDevices?.getUserMedia
    ) {
      const permissionTimeout = setTimeout(() => {
        console.warn("Audio permission request timed out");
      }, 2000);

      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          clearTimeout(permissionTimeout);
          stream.getTracks().forEach((track) => track.stop());
          console.log("Audio permissions granted");
        })
        .catch((err) => {
          clearTimeout(permissionTimeout);
          console.error("Audio permission error:", err.name, err.message);
          const notification = document.createElement("div");
          notification.style.cssText =
            "position:fixed;top:0;left:0;right:0;background:#f44336;color:white;padding:10px;text-align:center;z-index:9999";
          notification.textContent =
            "Microphone access is required for interviews. Please enable it in your browser settings.";
          document.body.appendChild(notification);
          setTimeout(() => notification.remove(), 5000);
        });
    } else {
      console.warn("MediaDevices API unavailable. Using mock Vapi.");
    }
  } catch (error) {
    console.error("Error in Vapi initialization:", error);
    vapi = createMockVapi();
  }
} else {
  vapi = createMockVapi();
}

export { vapi };
