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

    messages := []openai.ChatCompletionMessageParamUnion{
        openai.SystemMessage(`prompt file`),
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
