# QuizLens AI

QuizLens AI is a Chrome extension that reads quiz or assessment questions from the current page, sends the extracted question data to Gemini, and returns suggested answers. It also stores successful responses for each page URL so you can reopen the popup and see the previous result again.

## Features

- Extracts visible quiz questions and answer options from the active page.
- Supports radio-button and checkbox-style questions.
- Sends structured question data to Gemini for JSON-formatted answer suggestions.
- Can automatically apply returned option IDs on the page when supported by the page structure.
- Saves AI responses locally per page URL.
- Includes a content script that removes configured injected instruction blocks before extraction.
- Lets you choose the Gemini model from the popup.

## Setup

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension` folder from this project.
5. Open the extension popup, enter your Gemini API key, choose a model, and click **Save**.

## Usage

1. Open a page that contains quiz or assessment questions.
2. Click the QuizLens AI extension icon.
3. Click **Solve this assignment**.
4. Review the suggested answers shown in the popup.

If you return to the same URL later, the extension shows the previously saved response from local storage.

## Model

The default model is currently:

```text
gemini-3.8-flash
```

You can change the selected model from the popup settings.
.

## Notes

This extension stores your Gemini API key using Chrome extension storage and stores page-specific responses locally in the browser. Review AI-generated answers before relying on them.
