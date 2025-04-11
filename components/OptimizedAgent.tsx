"use client";

import Image from "next/image";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { vapi } from "@/lib/vapi.sdk";
import { interviewer } from "@/constants";
import { createFeedback } from "@/lib/actions/general.action";
import CopyButton from "./CopyButton";

enum CallStatus {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED",
  ERROR = "ERROR",
}

interface SavedMessage {
  role: "user" | "system" | "assistant";
  content: string;
}

const OptimizedAgent = ({
  userName,
  userId,
  interviewId,
  feedbackId,
  type,
  questions,
}: AgentProps) => {
  const router = useRouter();
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastMessage, setLastMessage] = useState<string>("");

  useEffect(() => {
    // Define all event handlers
    const handlers = {
      "call-start": () => {
        console.log("Call started");
        setCallStatus(CallStatus.ACTIVE);
      },
      "call-end": () => {
        console.log("Call ended normally");
        setCallStatus(CallStatus.FINISHED);
      },
      message: (message: Message) => {
        if (
          message.type === "transcript" &&
          message.transcriptType === "final"
        ) {
          const newMessage = {
            role: message.role,
            content: message.transcript,
          };
          setMessages((prev) => [...prev, newMessage]);
        }
      },
      "speech-start": () => setIsSpeaking(true),
      "speech-end": () => setIsSpeaking(false),
      error: (error: Error) => {
        console.error("Vapi error:", error);

        // Handle Daily.co meeting ended errors
        if (
          error &&
          typeof error.message === "string" &&
          (error.message.includes("Meeting has ended") ||
            error.message.includes("Meeting ended"))
        ) {
          console.log(
            "Meeting ended error detected in OptimizedAgent component"
          );
          setCallStatus(CallStatus.FINISHED);

          // Add a message to the conversation
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content:
                "The interview session has ended. Your responses have been saved.",
            },
          ]);
        }
      },
    };

    // Register all event handlers at once
    Object.entries(handlers).forEach(([event, handler]) => {
      vapi.on(event as any, handler);
    });

    // Add a special handler for unhandled errors
    const handleUnhandledError = (event: ErrorEvent) => {
      if (
        event.error &&
        typeof event.error.message === "string" &&
        (event.error.message.includes("Meeting has ended") ||
          event.error.message.includes("Meeting ended"))
      ) {
        console.log("Caught unhandled error in OptimizedAgent component");
        setCallStatus(CallStatus.FINISHED);
        event.preventDefault();
      }
    };

    // Add a handler for the custom vapi:meeting-ended event
    const handleMeetingEnded = (event: CustomEvent) => {
      console.log("Received vapi:meeting-ended event in OptimizedAgent");
      setCallStatus(CallStatus.FINISHED);

      // Add a message to the conversation
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content:
            "The interview session has ended. Your responses have been saved.",
        },
      ]);
    };

    window.addEventListener("error", handleUnhandledError);
    window.addEventListener(
      "vapi:meeting-ended",
      handleMeetingEnded as EventListener
    );

    // Return cleanup function
    return () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        vapi.off(event as any, handler);
      });
      window.removeEventListener("error", handleUnhandledError);
      window.removeEventListener(
        "vapi:meeting-ended",
        handleMeetingEnded as EventListener
      );
    };
  }, []);

  // Update last message efficiently
  useEffect(() => {
    if (messages.length > 0) {
      setLastMessage(messages[messages.length - 1].content);
    }
  }, [messages]);

  // Handle call completion separately
  useEffect(() => {
    if (callStatus !== CallStatus.FINISHED) return;

    const handleGenerateFeedback = async () => {
      try {
        // Show loading state or notification here if needed

        const { success, feedbackId: id } = await createFeedback({
          interviewId: interviewId!,
          userId: userId!,
          transcript: messages,
          feedbackId,
        });

        if (success && id) {
          router.push(`/interview/${interviewId}/feedback`);
        } else {
          console.error("Error saving feedback");
          router.push("/");
        }
      } catch (error) {
        console.error("Error generating feedback:", error);
        router.push("/");
      }
    };

    // Use a small timeout to ensure all messages are processed
    const timeoutId = setTimeout(() => {
      if (type === "generate") {
        router.push("/");
      } else {
        handleGenerateFeedback();
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [callStatus, feedbackId, interviewId, messages, router, type, userId]);

  // Pre-format questions to avoid doing this during the call initiation
  const formattedQuestions = questions
    ? questions.map((question) => `- ${question}`).join("\n")
    : "";

  // Add a timeout to prevent hanging on API calls
  const startCallWithTimeout = async (callFn: () => Promise<any>) => {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("Call initialization timed out")),
        5000
      );
    });

    try {
      // Check for browser compatibility issues before starting
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function"
      ) {
        console.warn(
          "Browser doesn't fully support MediaDevices API, but continuing anyway"
        );
        // Continue anyway instead of throwing an error
      }

      // Race between the actual call and the timeout
      await Promise.race([callFn(), timeoutPromise]);
      return true;
    } catch (error) {
      console.error("Call initialization error:", error);
      return false;
    }
  };

  const handleCall = useCallback(async () => {
    setCallStatus(CallStatus.CONNECTING);

    try {
      // Check if we need to reset the Vapi instance
      if (typeof window !== "undefined" && !window.__VAPI_INSTANCE__) {
        console.log("Reloading the page to reset Vapi instance");
        window.location.reload();
        return;
      }

      let success = false;

      if (type === "generate") {
        success = await startCallWithTimeout(() =>
          vapi.start(process.env.NEXT_PUBLIC_VAPI_WORKFLOW_ID!, {
            variableValues: {
              username: userName,
              userid: userId,
            },
          })
        );
      } else {
        success = await startCallWithTimeout(() =>
          vapi.start(interviewer, {
            variableValues: {
              questions: formattedQuestions,
            },
          })
        );
      }

      if (!success) {
        throw new Error("Call initialization timed out or failed");
      }
    } catch (error) {
      console.error("Error starting Vapi call:", error);
      setCallStatus(CallStatus.ERROR);

      // Check if this is a Daily.co error
      const errorMessage =
        error instanceof Error
          ? error.message
          : String(error || "Unknown error");
      const isDailyError =
        errorMessage.includes("Meeting") &&
        (errorMessage.includes("ended") || errorMessage.includes("has ended"));

      // Add a fallback message to the conversation
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: isDailyError
            ? "The interview session could not be started because a previous session is still active. Please try again in a moment."
            : "There was an error connecting to the voice interview. This may be due to missing microphone permissions or browser compatibility issues. Please check your browser settings and try again.",
        },
      ]);

      // If it's a Daily.co error, reset the instance after a delay
      if (isDailyError && typeof window !== "undefined") {
        setTimeout(() => {
          window.__VAPI_INSTANCE__ = undefined;
        }, 2000);
      }
    }
  }, [formattedQuestions, type, userName, userId]);

  const handleDisconnect = useCallback(() => {
    setCallStatus(CallStatus.FINISHED);
    vapi.stop();
  }, []);

  return (
    <>
      <div className="call-view">
        {/* AI Interviewer Card */}
        <div className="card-interviewer">
          <div className="avatar">
            <Image
              src="/ai-avatar.png"
              alt="profile-image"
              width={65}
              height={54}
              className="object-cover"
            />
            {isSpeaking && <span className="animate-speak" />}
          </div>
          <h3>AI Interviewer</h3>
        </div>

        {/* User Profile Card */}
        <div className="card-border max-md:block">
          <div className="card-content">
            <Image
              src="/user-avatar.png"
              alt="profile-image"
              width={539}
              height={539}
              className="rounded-full object-cover size-[120px]"
            />
            <h3>{userName}</h3>
          </div>
        </div>
      </div>

      {messages.length > 0 && (
        <div className="transcript-border">
          <div className="transcript">
            <p
              key={lastMessage}
              className={cn(
                "transition-opacity duration-500 opacity-0",
                "animate-fadeIn opacity-100"
              )}
            >
              {lastMessage}
            </p>
          </div>
          <div className="flex justify-end mt-2">
            <CopyButton
              text={messages.map((m) => `${m.role}: ${m.content}`).join("\n")}
              label="Copy Transcript"
              className="text-xs"
            />
          </div>
        </div>
      )}

      <div className="w-full flex justify-center">
        {callStatus !== "ACTIVE" ? (
          <button className="relative btn-call" onClick={handleCall}>
            <span
              className={cn(
                "absolute animate-ping rounded-full opacity-75",
                callStatus !== "CONNECTING" && "hidden"
              )}
            />
            {callStatus === "ERROR" ? (
              <>Retry Connection</>
            ) : callStatus === "CONNECTING" ? (
              <>Connecting...</>
            ) : (
              <>Start Interview</>
            )}
          </button>
        ) : (
          <button className="btn-disconnect" onClick={handleDisconnect}>
            End Call
          </button>
        )}
      </div>

      {callStatus === "ERROR" && (
        <div className="mt-4 text-center text-amber-500 max-w-md mx-auto">
          <p>
            There was an error connecting to the voice interview. Please check
            that:
          </p>
          <ul className="text-sm mt-2 list-disc text-left pl-8">
            <li>Your browser has permission to access your microphone</li>
            <li>You're using a supported browser (Chrome, Edge, or Safari)</li>
            <li>You're on a secure (HTTPS) connection</li>
          </ul>
        </div>
      )}
    </>
  );
};

export default OptimizedAgent;