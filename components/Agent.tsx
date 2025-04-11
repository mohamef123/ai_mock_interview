"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { vapi } from "@/lib/vapi.sdk";
import { interviewer } from "@/constants";
import { createFeedback } from "@/lib/actions/general.action";
import { Button } from "@/components/ui/button"

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

const Agent = ({
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
          console.log("Meeting ended error detected in Agent component");
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
        console.log("Caught unhandled error in Agent component");
        setCallStatus(CallStatus.FINISHED);
        event.preventDefault();
      }
    };

    window.addEventListener("error", handleUnhandledError);

    // Return cleanup function
    return () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        vapi.off(event as any, handler);
      });
      window.removeEventListener("error", handleUnhandledError);
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

  const handleCall = async () => {
    setCallStatus(CallStatus.CONNECTING);

    try {
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

      // Add a fallback message to the conversation with the specific error
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `There was an error connecting to the voice interview: ${
            error.message || "Unknown error"
          }. Please check your browser settings and try again.`,
        },
      ]);
    }
  };

  const handleDisconnect = () => {
    setCallStatus(CallStatus.FINISHED);
    vapi.stop();
  };

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
            <button
              text={messages.map((m) => `${m.role}: ${m.content}`).join("\n")}
              label="Copy Transcript"
              className="text-xs"
            />
          </div>
        </div>
      )}

      <div className="w-full flex justify-center">
        {callStatus !== "ACTIVE" ? (
          <button className="relative btn-call" onClick={() => handleCall()}>
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
          <button className="btn-disconnect" onClick={() => handleDisconnect()}>
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
            <li>Your microphone is properly connected and working</li>
            <li>No other applications are using your microphone</li>
          </ul>
          <div className="mt-4 p-3 bg-dark-300 rounded-lg text-xs text-left">
            <p className="font-bold">Troubleshooting steps:</p>
            <ol className="list-decimal pl-5 mt-1 space-y-1">
              <li>Refresh the page and try again</li>
              <li>
                Check browser settings: click the lock/info icon in your address
                bar and ensure microphone permissions are allowed
              </li>
              <li>Try using a different browser (Chrome works best)</li>
              <li>Restart your browser</li>
            </ol>
          </div>
        </div>
      )}
    </>
  );
};

export default Agent;