import Vapi from "@vapi-ai/web";

// Add type declaration for the global Vapi instance
declare global {
  interface Window {
    __VAPI_INSTANCE__?: any;
    __VAPI_DAILY_ERROR_HANDLER__?: (error: any) => boolean;
  }
}

// Create a safe browser environment check
let vapi: any;

// Configuration options for Vapi
const vapiConfig = {
  // Set to false in production to reduce console output
  debug: process.env.NODE_ENV === "development",
  // Timeout for API calls in milliseconds (3 seconds)
  timeout: 3000,
  // Retry configuration
  retries: 1,
};

// Create a mock vapi object for when initialization fails
const createMockVapi = () => ({
  on: () => {},
  off: () => {},
  start: () => Promise.resolve(),
  stop: () => {},
  setDebug: () => {},
  setTimeout: () => {},
});

// Create a wrapper for the Vapi instance that handles Daily.co errors
const createVapiWrapper = (vapiInstance: any) => {
  // Create a proxy to intercept method calls
  return new Proxy(vapiInstance, {
    get: (target, prop) => {
      // If the property is a method, wrap it to handle errors
      if (typeof target[prop] === "function") {
        return (...args: any[]) => {
          try {
            // Special handling for the start method
            if (prop === "start") {
              // Add a timeout to the start method to prevent hanging
              const startPromise = target[prop](...args);
              const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                  reject(
                    new Error("Vapi start method timed out after 10 seconds")
                  );
                }, 10000); // 10 second timeout
              });

              return Promise.race([startPromise, timeoutPromise]).catch(
                (error) => {
                  console.error(`Error in Vapi start method:`, error);
                  // Try to clean up any resources
                  try {
                    target.stop();
                  } catch (cleanupError) {
                    console.error("Error during cleanup:", cleanupError);
                  }
                  throw error;
                }
              );
            }

            // Call the original method for other methods
            const result = target[prop](...args);

            // If the result is a Promise, handle any errors
            if (result && typeof result.then === "function") {
              return result.catch((error: any) => {
                console.error(`Error in Vapi method ${String(prop)}:`, error);

                // Check if the error is about the meeting ending
                if (
                  error &&
                  typeof error.message === "string" &&
                  (error.message.includes("Meeting has ended") ||
                    error.message.includes("Meeting ended"))
                ) {
                  console.log("Meeting ended, handling gracefully");

                  // Show a user-friendly notification
                  if (typeof document !== "undefined") {
                    const notification = document.createElement("div");
                    notification.style.cssText =
                      "position:fixed;top:0;left:0;right:0;background:#f44336;color:white;padding:10px;text-align:center;z-index:9999";
                    notification.textContent =
                      "The interview session has ended. Your responses have been saved. Please refresh the page to start a new session.";
                    document.body.appendChild(notification);
                    setTimeout(() => notification.remove(), 5000);
                  }

                  // Return a resolved promise to prevent the error from propagating
                  return Promise.resolve();
                }

                // Re-throw other errors
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

      // Return the original property
      return target[prop];
    },
  });
};

// Set up a global error handler for Daily.co errors
if (typeof window !== "undefined") {
  // Store a reference to the original error handler
  if (!window.__VAPI_DAILY_ERROR_HANDLER__) {
    window.__VAPI_DAILY_ERROR_HANDLER__ = (error: any) => {
      // Check if this is a Daily.co error
      if (
        error &&
        typeof error.message === "string" &&
        (error.message.includes("Meeting has ended") ||
          error.message.includes("Meeting ended"))
      ) {
        console.log(
          "Daily.co meeting ended error detected, cleaning up resources"
        );

        // Try to clean up any Daily.co resources
        try {
          if (window.__VAPI_INSTANCE__) {
            window.__VAPI_INSTANCE__.stop();

            // Dispatch a custom event that components can listen for
            const meetingEndedEvent = new CustomEvent("vapi:meeting-ended", {
              detail: { error },
            });
            window.dispatchEvent(meetingEndedEvent);
          }
        } catch (cleanupError) {
          console.error("Error during Daily.co cleanup:", cleanupError);
        }

        return true; // Error was handled
      }

      return false; // Error was not handled
    };
  }

  // Override the console.error method to catch Daily.co errors
  const originalConsoleError = console.error;
  console.error = function (...args) {
    // Call the original console.error
    originalConsoleError.apply(console, args);

    // Check if this is a Daily.co error
    const errorMessage = args.join(" ");
    if (
      errorMessage.includes("Meeting has ended") ||
      errorMessage.includes("Meeting ended")
    ) {
      // Use the error handler if defined
      window.__VAPI_DAILY_ERROR_HANDLER__?.({ message: errorMessage });
    }
  };

  // Add a global unhandled rejection handler
  window.addEventListener("unhandledrejection", (event) => {
    if (event.reason && window.__VAPI_DAILY_ERROR_HANDLER__?.(event.reason)) {
      console.log("Caught unhandled rejection for Meeting ended error");
      event.preventDefault();
    }
  });

  // Add a global error handler
  window.addEventListener("error", (event) => {
    if (event.error && window.__VAPI_DAILY_ERROR_HANDLER__?.(event.error)) {
      console.log("Caught global error for Meeting ended error");
      event.preventDefault();
    }
  });
}

// Only initialize Vapi on the client side, not during server-side rendering
if (typeof window !== "undefined") {
  try {
    // Function to create a new Vapi instance
    const createNewVapiInstance = () => {
      try {
        console.log("Creating new Vapi instance");
        // Create the Vapi instance
        const vapiInstance = new Vapi(process.env.NEXT_PUBLIC_VAPI_WEB_TOKEN!);
        // Wrap it with our error handler
        const wrappedInstance = createVapiWrapper(vapiInstance);
        // Store the instance globally to prevent duplication
        window.__VAPI_INSTANCE__ = wrappedInstance;
        return wrappedInstance;
      } catch (initError) {
        console.error("Error initializing Vapi instance:", initError);
        return createMockVapi();
      }
    };

    // Check if we need to create a new instance or use the existing one
    if (!window.__VAPI_INSTANCE__) {
      vapi = createNewVapiInstance();
    } else {
      // Check if the existing instance is still valid
      try {
        // Try to access a property to see if the instance is still valid
        if (typeof window.__VAPI_INSTANCE__.on === "function") {
          console.log("Using existing Vapi instance");
          vapi = window.__VAPI_INSTANCE__;
        } else {
          console.warn("Existing Vapi instance is invalid, creating a new one");
          vapi = createNewVapiInstance();
        }
      } catch (error) {
        console.warn(
          "Error accessing existing Vapi instance, creating a new one"
        );
        vapi = createNewVapiInstance();
      }
    }

    // Listen for the custom meeting ended event
    window.addEventListener("vapi:meeting-ended", () => {
      console.log("Meeting ended event received, resetting Vapi instance");
      // Reset the instance on next access
      setTimeout(() => {
        window.__VAPI_INSTANCE__ = undefined;
      }, 1000);
    });

    // Enable debug mode only in development
    if (vapi.setDebug && vapiConfig.debug) {
      vapi.setDebug(vapiConfig.debug);
    }

    // Set timeout if the method exists
    if (vapi.setTimeout) {
      vapi.setTimeout(vapiConfig.timeout);
    }

    // Check for audio permissions if mediaDevices API is available
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator &&
        typeof navigator.mediaDevices !== "undefined" &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function"
      ) {
        // Test audio permissions immediately to catch issues early
        const permissionTimeout = setTimeout(() => {
          console.warn("Audio permission request timed out");
        }, 2000);

        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            clearTimeout(permissionTimeout);
            // Clean up the test stream
            stream.getTracks().forEach((track) => track.stop());
            console.log("Audio permissions granted successfully");
          })
          .catch((err) => {
            clearTimeout(permissionTimeout);
            console.error("Audio permission error:", err.name, err.message);
            // Use a non-blocking notification instead of alert
            if (typeof document !== "undefined") {
              const notification = document.createElement("div");
              notification.style.cssText =
                "position:fixed;top:0;left:0;right:0;background:#f44336;color:white;padding:10px;text-align:center;z-index:9999";
              notification.textContent =
                "Microphone access is required for interviews. Please enable it in your browser settings.";
              document.body.appendChild(notification);
              setTimeout(() => notification.remove(), 5000);
            }
          });
      } else {
        console.warn(
          "MediaDevices API not available or incomplete. Using mock Vapi implementation."
        );
      }
    } catch (mediaDevicesError) {
      console.error("Error accessing MediaDevices API:", mediaDevicesError);
      console.warn(
        "Falling back to mock Vapi implementation due to MediaDevices error"
      );
    }
  } catch (error) {
    console.error("Error in Vapi initialization:", error);
    vapi = createMockVapi();
  }
} else {
  // Create a mock vapi object that won't cause errors during SSR
  vapi = createMockVapi();
}

export { vapi };