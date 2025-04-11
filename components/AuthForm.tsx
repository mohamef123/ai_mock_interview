"use client";

import { z } from "zod";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { auth } from "@/firebase/client";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useEffect } from "react";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  UserCredential,
  Auth,
} from "firebase/auth";

import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

import { signIn, signUp } from "@/lib/actions/auth.action";
import FormField from "./FormField";

// Create a fallback authentication function
const createFallbackAuth = (email: string, uid: string) => {
  // Store basic auth info in localStorage
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(
        "fallbackAuth",
        JSON.stringify({
          email,
          uid,
          timestamp: Date.now(),
          isAuthenticated: true,
        })
      );
      console.log("Fallback auth created successfully");
    } catch (error) {
      console.error("Error storing fallback auth:", error);
    }
  }
};

// Check if we're in production environment
const isProduction = process.env.NODE_ENV === "production";

// Adjust timeouts based on environment
const getTimeouts = () => {
  // Use shorter timeouts in production
  if (isProduction) {
    return {
      firebase: 5000, // 5 seconds in production
      token: 3000, // 3 seconds in production
      server: 8000, // 8 seconds in production
      internal: 6000, // 6 seconds in production
    };
  }

  // Use longer timeouts in development
  return {
    firebase: 10000, // 10 seconds in development
    token: 5000, // 5 seconds in development
    server: 15000, // 15 seconds in development
    internal: 12000, // 12 seconds in development
  };
};

const authFormSchema = (type: FormType) => {
  return z.object({
    name: type === "sign-up" ? z.string().min(3) : z.string().optional(),
    email: z.string().email(),
    password: z.string().min(3),
  });
};

const AuthForm = ({ type }: { type: FormType }) => {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEnvironmentReady, setIsEnvironmentReady] = useState(false);
  const timeouts = getTimeouts();

  // Check environment on component mount
  useEffect(() => {
    console.log(`Running in ${process.env.NODE_ENV} environment`);
    console.log(`Using timeouts: ${JSON.stringify(timeouts)}`);
    setIsEnvironmentReady(true);
  }, []);

  const formSchema = authFormSchema(type);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    // Prevent multiple submissions
    if (isSubmitting) return;

    setIsSubmitting(true);
    let timeoutIds: NodeJS.Timeout[] = [];

    try {
      if (type === "sign-up") {
        const { name, email, password } = data;

        // Add timeout for Firebase operations
        const authPromise = createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

        // Create a timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          const id = setTimeout(
            () => reject(new Error("Authentication timed out")),
            timeouts.firebase
          );
          timeoutIds.push(id);
        });

        try {
          // Race the auth operation against a timeout
          const userCredential = await Promise.race<UserCredential>([
            authPromise,
            timeoutPromise,
          ]);

          const result = await signUp({
            uid: userCredential.user.uid,
            name: name!,
            email,
            password,
          });

          if (!result.success) {
            toast.error(result.message);
            setIsSubmitting(false);
            return;
          }

          toast.success("Account created successfully. Please sign in.");
          router.push("/sign-in");
        } catch (error: any) {
          console.error("Sign-up error:", error);
          if (error.message === "Authentication timed out") {
            toast.error("Authentication timed out. Please try again later.");
          } else {
            toast.error(`Sign-up error: ${error.message || "Unknown error"}`);
          }
          setIsSubmitting(false);
          return;
        }
      } else {
        const { email, password } = data;

        // Show loading toast
        const loadingToast = toast.loading("Signing in...");

        // Simplified sign-in flow with better error handling
        try {
          console.log("Starting Firebase authentication...");

          // Create a single AbortController for all fetch operations
          const controller = new AbortController();
          const abortTimeoutId = setTimeout(
            () => controller.abort(),
            timeouts.firebase
          );
          timeoutIds.push(abortTimeoutId);

          // Single timeout for the entire authentication process
          const globalTimeoutId = setTimeout(() => {
            console.log("Global authentication timeout reached");
            // Clean up and use fallback
            createFallbackAuth(email, `temp-${Date.now()}`);

            toast.dismiss(loadingToast);
            toast.warning(
              "Authentication taking longer than expected. Using offline mode."
            );

            setIsSubmitting(false);
            router.push("/");
          }, timeouts.server);
          timeoutIds.push(globalTimeoutId);

          // Single try-catch for the entire Firebase auth flow
          const userCredential = await signInWithEmailAndPassword(
            auth,
            email,
            password
          );
          console.log("Firebase auth completed successfully");

          // Get token
          console.log("Requesting ID token...");
          const idToken = await userCredential.user.getIdToken();
          console.log("ID token retrieved successfully");

          if (!idToken) {
            throw new Error("Failed to retrieve authentication token");
          }

          // Call server action
          console.log("Calling server action...");
          const response = await signIn({ email, idToken });
          console.log("Server action completed:", response);

          // Clear all timeouts
          clearTimeout(globalTimeoutId);
          clearTimeout(abortTimeoutId);

          toast.dismiss(loadingToast);

          if (response.success) {
            toast.success(response.message || "Signed in successfully.");
            router.push("/");
          } else {
            toast.error(
              response.message || "Failed to sign in. Please try again."
            );
            setIsSubmitting(false);
          }
        } catch (error: any) {
          console.error("Sign-in error:", error);
          toast.dismiss(loadingToast);

          // If aborted or timeout, use fallback
          if (
            error.name === "AbortError" ||
            error.message?.includes("timeout")
          ) {
            console.log("Using fallback authentication due to timeout");
            createFallbackAuth(email, `fallback-${Date.now()}`);
            toast.warning("Using offline mode due to slow connection.");
            router.push("/");
            return;
          }

          // Handle specific Firebase auth errors
          if (error.code === "auth/user-not-found") {
            toast.error(
              "User not found. Please check your email or create an account."
            );
          } else if (error.code === "auth/wrong-password") {
            toast.error("Incorrect password. Please try again.");
          } else if (error.code === "auth/invalid-credential") {
            toast.error(
              "Invalid credentials. Please check your email and password."
            );
          } else if (error.code === "auth/network-request-failed") {
            toast.error(
              "Network error. Please check your connection and try again."
            );
            // Use fallback for network errors
            createFallbackAuth(email, `fallback-${Date.now()}`);
            toast.warning("Using offline mode.");
            router.push("/");
          } else {
            toast.error(`Sign-in error: ${error.message || "Unknown error"}`);
          }
          setIsSubmitting(false);
        }
      }
    } catch (error: any) {
      console.error("Outer error:", error);

      // Handle specific Firebase auth errors
      if (error.code === "auth/user-not-found") {
        toast.error(
          "User not found. Please check your email or create an account."
        );
      } else if (error.code === "auth/wrong-password") {
        toast.error("Incorrect password. Please try again.");
      } else if (error.code === "auth/invalid-credential") {
        toast.error(
          "Invalid credentials. Please check your email and password."
        );
      } else if (error.code === "auth/email-already-in-use") {
        toast.error("Email already in use. Please sign in instead.");
      } else if (error.code === "auth/network-request-failed") {
        toast.error(
          "Network error. Please check your connection and try again."
        );
      } else {
        toast.error(`There was an error: ${error.message || error}`);
      }
      setIsSubmitting(false);
    } finally {
      // Clean up all timeouts
      timeoutIds.forEach((id) => clearTimeout(id));
      setIsSubmitting(false);
    }
  };

  const isSignIn = type === "sign-in";

  return (
    <div className="card-border lg:min-w-[566px]">
      <div className="flex flex-col gap-6 card py-14 px-10">
        <div className="flex flex-row gap-2 justify-center">
          <Image
            src="/logo.svg"
            alt="PrepWise Logo"
            width={38}
            height={34}
            style={{ width: "auto", height: "auto" }}
          />
          <h2 className="text-primary-100">PrepWise</h2>
        </div>

        <h3>Practice job interviews with AI</h3>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="w-full space-y-6 mt-4 form"
          >
            {!isSignIn && (
              <FormField
                control={form.control}
                name="name"
                label="Name"
                placeholder="Your Name"
                type="text"
              />
            )}

            <FormField
              control={form.control}
              name="email"
              label="Email"
              placeholder="Your email address"
              type="email"
            />

            <FormField
              control={form.control}
              name="password"
              label="Password"
              placeholder="Enter your password"
              type="password"
            />

            <Button
              className="btn"
              type="submit"
              disabled={isSubmitting || !isEnvironmentReady}
            >
              {isSubmitting
                ? isSignIn
                  ? "Signing In..."
                  : "Creating Account..."
                : isSignIn
                ? "Sign In"
                : "Create an Account"}
            </Button>
          </form>
        </Form>

        <p className="text-center">
          {isSignIn ? "No account yet?" : "Have an account already?"}
          <Link
            href={!isSignIn ? "/sign-in" : "/sign-up"}
            className="font-bold text-user-primary ml-1"
          >
            {!isSignIn ? "Sign In" : "Sign Up"}
          </Link>
        </p>
      </div>
    </div>
  );
};

export default AuthForm;