package util

import (
    "context"
    "fmt"
    "log"
    "os"

    "github.com/openai/openai-go/v2"
    "github.com/openai/openai-go/v2/option"
)

func AskAI(text string) (string, error) {

    apiKey := os.Getenv("OPENROUTER_API_KEY")
    if apiKey == "" {
        return "", fmt.Errorf("API key is required")
    }

    client := openai.NewClient(
        option.WithBaseURL("https://openrouter.ai/api/v1"),
        option.WithAPIKey(apiKey),
    )

    ctx := context.Background()

    messages := []openai.ChatCompletionMessageParamUnion{
        openai.SystemMessage(`
You are a content moderation classifier.
Analyze the following text and determine whether it contains:
1. "spam" — Unwanted advertising, promotional content, repetitive posts,
   automated messages, suspicious links, flooding, or irrelevant content.
2. "inappropriate" — Inappropriate content such as explicit sexual content,
   harassment, threats, hateful content, or excessively violent content.
3. "clean" — Normal content that does not fall into either category.
Rules:
- Do not flag content simply because it contains profanity or criticism.
- Base your decision only on the provided text.
- If there is reasonable doubt, prefer "clean".
- A message containing a link is not necessarily spam.
- Return JSON only. No additional explanation.
Output format:
{
  "classification": "clean | spam | inappropriate",
  "confidence": 0.0,
  "reason": "Brief explanation"
}
`),
        openai.UserMessage("Analyze this text: " + text),
    }

    params := openai.ChatCompletionNewParams{
        Model:    "google/gemma-4-31b-it:free",
        Messages: messages,
    }

    res, err := client.Chat.Completions.New(context.Background(), params)
    if err != nil {
        return "", fmt.Errorf("AI request failed: %w", err)
    }

    if len(res.Choices) == 0 {
        return "", fmt.Errorf("AI returned no choices")
    }

    return res.Choices[0].Message.Content, nil
}
