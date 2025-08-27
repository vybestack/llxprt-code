# Welcome Screen Project Plan

## 1. Overview

This document outlines the plan to create a new welcome screen for LLxprt Code. The goal is to provide a helpful, one-time guide for new users that appears immediately after the initial theme selection. This screen will orient them and provide clear, actionable next steps to begin using the tool effectively.

## 2. Core Concept

The welcome screen will be implemented as a **modal dialog** that appears on the user's very first startup. It is not a persistent panel like the Todo list, nor is it conversational output from the model. It is a piece of the application's UI.

## 3. Display Trigger

-   The dialog will be displayed **only once**, on the first run of the application.
-   Upon dismissal, a flag (e.g., `welcomeScreenShown: true`) will be set in the user's local configuration or `localStorage`.
-   On subsequent startups, the application will check for this flag and will not display the dialog if the flag is present.

## 4. Content to be Displayed

The dialog will be a compact, read-only view presenting the following key information, structured for clarity:

-   **Header:** A simple "Welcome to LLxprt Code!" message.
-   **Popular Cloud Setups:**
    -   Google Gemini (default).
    -   Qwen (free tier, via `/provider` and `/auth`).
    -   Claude Pro/Max (account login, via `/provider` and `/auth`).
-   **Local & Custom Models:**
    -   Instructions on how to connect to a local server (e.g., LM Studio) using `/provider openai` and `/baseurl`.
-   **Session Configuration:**
    -   `/model <name>`: To select a specific model.
    -   `/set param <val>`: To adjust model behavior like `context-limit`.
    -   `/settings`: To tweak CLI-specific behavior.
-   **Saving & Loading Setups:**
    -   `/profile save <name>`: To save the complete configuration (provider, model, key, `/set` parameters).
    -   `/profile load <name>`: To restore a saved configuration.
-   **Footer:** A prompt to ask a question or type `/help` for more commands.

## 5. Basic Functionality

-   The dialog will appear centered in the terminal.
-   It will be dismissible via a key press (e.g., `Enter` or `ESC`).
-   It will be non-interactive; users cannot type into it, only close it.
